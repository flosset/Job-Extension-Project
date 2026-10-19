// Regression coverage for editor data ownership and the privacy wipe barrier.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, POPUP_JS, CONTENT_SRC } = require("../_popup-source");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function editor() {
  const store = {};
  const dom = new JSDOM(fs.readFileSync(path.join(APP_DIR, "options.html"), "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true
  });
  const w = dom.window;
  w.confirm = () => true;
  let hold = null;
  w.chrome = {
    storage: { local: {
      get: async () => structuredClone(store),
      set: async (values) => {
        const snapshot = structuredClone(values);
        if (hold) await hold;
        Object.assign(store, snapshot);
      },
      remove: async (keys) => keys.forEach((key) => { delete store[key]; })
    } },
    runtime: { onMessage: { addListener() {} }, sendMessage() {} }
  };
  w.eval(POPUP_JS + `\nwindow.T = { loadProfile, fillFormFromProfile, persist,
    deleteAllData, clearResumeFile, onResumeFilePicked, switchProfile, loadProfiles,
    parseImportRecords, buildExportText, applicationsCsv, onImportFilePicked, locateField,
    setTab: (id) => { activeTabId = id; },
    setApps: (items) => { applicationState = { items }; },
    setProfiles: (state) => { profileState = state; },
    getState: () => ({ profileState, storedProfile, storedResume, pendingResume, formDirty }) };`);
  await sleep(60);
  return { w, store, T: w.T, hold: (promise) => { hold = promise; },
    edit: (id, value) => {
      w.document.getElementById(id).value = value;
      w.document.getElementById(id).dispatchEvent(new w.Event("input", { bubbles: true }));
    } };
}

(async () => {
  const e = await editor();
  e.edit("firstName", "Sensitive");
  await e.T.deleteAllData();
  await sleep(480);
  assert.deepStrictEqual(e.store, {}, "queued autosave must not recreate deleted keys");
  assert.strictEqual(e.T.getState().storedProfile.firstName, undefined);
  assert.strictEqual(e.T.getState().profileState.items.length, 0);

  let release;
  e.hold(new Promise((resolve) => { release = resolve; }));
  const writing = e.T.persist({ firstName: "In flight" });
  await sleep(5);
  const wiping = e.T.deleteAllData();
  release();
  await Promise.all([writing, wiping]);
  e.hold(null);
  assert.deepStrictEqual(e.store, {}, "wipe must drain already-issued writes before removing keys");

  e.T.fillFormFromProfile({ customSnippets: [{ key: "salary", value: "100" }],
    resumeFile: { name: "old.pdf", dataUrl: "data:application/pdf;base64,AAA" } });
  e.w.document.querySelector("#snippetRows .snip-del").click();
  e.T.clearResumeFile();
  await sleep(480);
  assert.strictEqual(e.store.jobProfile.customSnippets.length, 0);
  assert.strictEqual(e.store.jobProfile.resumeFile, null);

  let reader;
  e.w.FileReader = class {
    constructor() { reader = this; }
    readAsDataURL() {}
  };
  const fileInput = e.w.document.getElementById("resumeFile");
  Object.defineProperty(fileInput, "files", { configurable: true,
    value: [{ name: "new.pdf", type: "application/pdf", size: 9 }] });
  e.T.onResumeFilePicked();
  reader.result = "data:application/pdf;base64,NEW";
  reader.onload();
  await sleep(480);
  assert.strictEqual(e.store.jobProfile.resumeFile.name, "new.pdf");
  e.T.onResumeFilePicked();
  await e.T.deleteAllData();
  reader.onload();
  await sleep(480);
  assert.deepStrictEqual(e.store, {}, "late file-reader callbacks must not restore a deleted resume");

  const profiles = { activeId: "a", items: [
    { id: "a", name: "Alice", profile: { firstName: "Alice", lastName: "Old", email: "a@example.com" } },
    { id: "b", name: "Bob", profile: { firstName: "Bob" } }
  ] };
  e.store.jobProfiles = profiles;
  e.store.jobProfile = profiles.items[0].profile;
  await e.T.loadProfiles();
  await e.T.loadProfile();
  const select = e.w.document.getElementById("profileSelect");
  select.innerHTML = '<option value="a">A</option><option value="b">B</option>';
  e.edit("firstName", "Edited Alice");
  select.value = "b";
  await e.T.switchProfile();
  assert.strictEqual(e.store.jobProfiles.items[0].profile.firstName, "Edited Alice");
  assert.strictEqual(e.w.document.getElementById("firstName").value, "Bob");
  assert.strictEqual(e.w.document.getElementById("lastName").value, "");
  assert.strictEqual(e.w.document.getElementById("email").value, "");
  await sleep(480);
  assert.strictEqual(e.store.jobProfile.firstName, "Bob");

  const absent = e.T.parseImportRecords('{"firstName":"Legacy"}');
  const empty = e.T.parseImportRecords('{"profile":{"firstName":"New"},"widgets":[],"applications":{"items":[]}}');
  assert.strictEqual(absent.sections.applications, false);
  assert.strictEqual(empty.sections.applications, true);
  assert.strictEqual(empty.applications.items.length, 0);
  e.store.applications = { items: [{ company: "Old", role: "Old" }] };
  Object.defineProperty(e.w.document.getElementById("importFile"), "files", {
    configurable: true, value: [{ text: async () => JSON.stringify({
      profile: { firstName: "Restored" }, applications: { items: [] }, widgets: []
    }) }]
  });
  await e.T.onImportFilePicked();
  assert.strictEqual(e.store.applications.items.length, 0);
  assert.strictEqual(e.store.jobRecipes.items.length, 0);
  assert.strictEqual(e.store.jobProfiles.items[1].profile.firstName, "Restored");
  e.T.setApps([{ company: '=HYPERLINK("bad")', role: "+SUM(1,2)", status: "saved" }]);
  assert.ok(e.T.applicationsCsv().includes("'="));
  assert.ok(e.T.applicationsCsv().includes("'+"));
  let locationOptions;
  e.w.chrome.tabs = { sendMessage: async (tab, message, options) => { locationOptions = options; } };
  e.T.setTab(7);
  await e.T.locateField("inner-ref", null, 12);
  assert.strictEqual(locationOptions.frameId, 12);

  const dom = new JSDOM('<div id="host"></div>', { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  const root = w.document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<span id="label">Unusual question</span><input aria-labelledby="label">';
  w.Element.prototype.getClientRects = () => [{ width: 1, height: 1 }];
  const listeners = [];
  let learningWrites = 0;
  w.chrome = { storage: { local: { get: async () => ({ jobProfile: {} }),
    set: async () => { learningWrites++; } },
    onChanged: { addListener: (listener) => listeners.push(listener) } },
    runtime: { sendMessage() {}, onMessage: { addListener() {} } } };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun;
  const JA = w.__JobAutofill;
  const field = root.querySelector("input");
  assert.ok(JA.getSignal(field).includes("Unusual question"));
  assert.strictEqual(JA.labelTextFor(field), "Unusual question");
  const ref = JA.refFor(field);
  assert.strictEqual(JA.findByRef(ref), field);
  assert.strictEqual(w.__jobAutofillDeleteApproval, undefined);
  JA.armLearning([{ label: "Unusual question", ref }]);
  field.value = "Typed answer";
  field.dispatchEvent(new w.Event("change", { bubbles: true, composed: true }));
  for (const listener of listeners) listener({ jobProfile: { oldValue: {}, newValue: undefined } }, "local");
  field.dispatchEvent(new w.Event("change", { bubbles: true, composed: true }));
  await sleep(700);
  assert.strictEqual(learningWrites, 0, "live learners must stop after a profile wipe");
  e.w.close();
  w.close();
  console.log("EDITOR-PRIVACY E2E PASS");
})().catch((err) => { console.error(err); process.exitCode = 1; });