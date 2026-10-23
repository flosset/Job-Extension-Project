"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, POPUP_SCRIPTS } = require("../_popup-source");
const read = file => fs.readFileSync(path.join(APP_DIR, file), "utf8");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const windows = [];
let writes = Promise.resolve();
const locks = { request: (_, task) => {
  const next = writes.catch(() => {}).then(task);
  writes = next;
  return next;
} };

async function editor(store) {
  const w = new JSDOM(read("options.html"), { runScripts: "outside-only", pretendToBeVisual: true }).window;
  windows.push(w);
  Object.defineProperty(w.navigator, "locks", { value: locks });
  w.chrome = {
    storage: { local: {
      get: async () => structuredClone(store),
      set: async values => { await sleep(2); Object.assign(store, structuredClone(values)); },
      remove: async keys => keys.forEach(key => delete store[key])
    } },
    tabs: { query: async () => [{ id: 7, title: "New role", url: "https://jobs.example.com/new" }], sendMessage: async () => {} }
  };
  w.prompt = () => "Copy";
  w.eval(POPUP_SCRIPTS.filter(file => file !== "ui/app.js").map(read).join("\n") + `
    window.T = { loadProfiles, loadProfile, loadApplications, saveProfile, persist,
      setApplicationStatus, deleteApplication, setApplicationName, duplicateActiveProfile,
      createNewProfile, profileChanged, saveAllWidgets, pageForTab, restoreRun, renderUnfilled, addSnippetRow,
      enableAuto: () => { autoSaveEnabled = true; },
      setupWidgets: (items, candidates) => {
        recipeState = { items }; widgetCandidates = { candidates, skipped: [] };
        document.getElementById('widgetSection').widgetList = candidates;
      }, SH: JOB_AUTOFILL_SHARED };`);
  await w.T.loadProfiles();
  await w.T.loadProfile();
  await w.T.loadApplications();
  return w;
}
const seed = () => ({ jobProfile: { firstName: "Test", email: "old@example.com", phone: "5550100" } });
const recipe = id => ({ id, host: "jobs.example.com", name: id, anchor: [id],
  fields: { answer: ["answer"] }, rows: [{ answer: { source: "literal", value: "yes" } }] });

(async () => {
  const store = seed(), a = await editor(store), b = await editor(store);
  a.document.getElementById("email").value = "new@example.com";
  b.document.getElementById("phone").value = "5550199";
  await Promise.all([a.T.saveProfile(), b.T.saveProfile()]);
  assert.strictEqual(store.jobProfile.email, "new@example.com", "concurrent stale editors preserve other fields");
  assert.strictEqual(store.jobProfile.phone, "5550199");
  assert.strictEqual(store.jobProfiles.items[0].profile.email, "new@example.com");
  a.T.addSnippetRow("salary", "100");
  const node = a.document.querySelector("#snippetRows .snip-value");
  node.focus();
  await a.T.saveProfile();
  assert.strictEqual(a.document.activeElement, node, "saving preserves focus");
  await a.T.persist({ firstName: "Changed" });
  await a.T.persist({ firstName: "Test" });
  assert.strictEqual(store.jobProfile.firstName, "Test", "reverting a saved edit persists");
  const first = a.T.persist({ firstName: "Queued" });
  const second = a.T.persist({ firstName: "Test" });
  await Promise.all([first, second]);
  assert.strictEqual(store.jobProfile.firstName, "Test", "queued edits retain their order");

  const logStore = { ...seed(), applications: { items: [{ id: "one", company: "Example", role: "One", url: "https://jobs.example.com/1" }] } };
  const tracker = await editor(logStore);
  await tracker.T.SH.logApplication({ company: "Example", role: "Two", url: "https://jobs.example.com/2" });
  await tracker.T.setApplicationStatus("one", "applied");
  assert.strictEqual(logStore.applications.items.length, 2, "editing an older row preserves new applications");
  await Promise.all([
    tracker.T.SH.logApplication({ company: "Example", role: "Three", url: "https://jobs.example.com/3" }),
    tracker.T.setApplicationName("one", "Renamed", "One")
  ]);
  assert.strictEqual(logStore.applications.items.length, 3);
  await tracker.T.deleteApplication("one");
  assert.strictEqual(logStore.applications.items.length, 2);

  for (const action of ["duplicateActiveProfile", "createNewProfile"]) {
    const data = seed(), w = await editor(data);
    w.T.enableAuto();
    w.document.getElementById("firstName").value = "Edited";
    w.T.profileChanged();
    await w.T[action]();
    await sleep(450);
    assert.strictEqual(data.jobProfiles.items.length, 2);
    assert(data.jobProfiles.items.every(item => item.profile.firstName === "Edited"), action + " flushes pending edits");
  }

  const oldRecipes = Array.from({ length: 20 }, (_, i) => recipe("old" + i));
  const pending = recipe("pending");
  const fullStore = { ...seed(), jobRecipes: { items: oldRecipes }, widgetCandidates: { candidates: [pending], skipped: [] } };
  const full = await editor(fullStore);
  full.T.setupWidgets(oldRecipes, [pending]);
  await full.T.saveAllWidgets();
  assert.strictEqual(fullStore.jobRecipes.items.length, 20);
  assert(fullStore.jobRecipes.items.some(item => item.id === "old19"), "capacity never evicts existing widgets");
  assert.strictEqual(fullStore.widgetCandidates.candidates.length, 1);
  assert(full.document.getElementById("status").textContent.includes("limit"));

  const failureStore = { ...seed(), widgetCandidates: { candidates: [pending], skipped: [] } };
  const failed = await editor(failureStore);
  failed.T.setupWidgets([], [pending]);
  const set = failed.chrome.storage.local.set;
  failed.chrome.storage.local.set = async values => {
    if (values.jobRecipes) throw new Error("storage unavailable");
    return set(values);
  };
  await failed.T.saveAllWidgets();
  assert.strictEqual(failureStore.jobRecipes, undefined);
  assert.strictEqual(failureStore.widgetCandidates.candidates.length, 1, "failed saves preserve suggestions");
  assert(failed.document.getElementById("status").textContent.startsWith("Could not save"));
  failed.chrome.storage.local.set = set;
  await failed.T.saveAllWidgets();
  assert.strictEqual(failureStore.jobRecipes.items.length, 1, "the same suggestion can be retried");
  assert.strictEqual(failureStore.widgetCandidates.candidates.length, 0);

  const navStore = { ...seed(), lastRuns: { "7": { at: Date.now(), page: {
    company: "Old Employer", role: "Old role", url: "https://jobs.example.com/old"
  }, results: { unfilled: [{ label: "Old field", ref: "old" }] } } } };
  const nav = await editor(navStore);
  assert.strictEqual((await nav.T.pageForTab()).company, "", "navigation rejects old employer metadata");
  const list = nav.document.createElement("ul"); list.id = "unfilledList"; nav.document.body.append(list);
  await nav.T.restoreRun();
  assert.strictEqual(list.children.length, 0, "navigation rejects old remaining fields");
  navStore.lastRuns["7"].page.url = "https://jobs.example.com/new";
  assert.strictEqual((await nav.T.pageForTab()).company, "Old Employer", "worker records supply matching job metadata");
  navStore.lastRuns["7"].at = Date.now() - nav.T.SH.runMaxAgeMs - 1;
  assert.strictEqual((await nav.T.pageForTab()).company, "", "expired metadata is rejected");
  nav.T.renderUnfilled([{ label: "Location", ref: "location", required: true, frameId: 2 }]);
  const button = list.querySelector("button");
  assert(button && button.type === "button" && button.textContent.includes("Location"), "locating uses a native keyboard-operable button");
  console.log("AUDIT UI REGRESSIONS PASS");
})().finally(() => windows.forEach(w => w.close())).catch(error => { console.error(error); process.exitCode = 1; });
