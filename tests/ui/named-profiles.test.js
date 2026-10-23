// named-profiles.test.js — multiple profiles (a "Frontend" resume vs a "Full-stack" one).
//
// The design under test: a profile is a COMPLETE copy of the profile object,
// including its own resume, and the ACTIVE one is mirrored into the jobProfile
// key — the single record the injected script reads. So switching profiles is
// one storage write, and the fill engine never needs to know profiles exist.
"use strict";
const { JSDOM } = require("jsdom");
const { POPUP_JS, SHARED } = require("../_popup-source");

const PROFILES_KEY = SHARED.keys.profiles;
const PROFILE_KEY = SHARED.keys.profile;

const SHELL = `<!doctype html><html><body data-page="options">
  <select id="profileSelect"></select>
  <form id="profileForm">
    <input id="firstName" /><input id="lastName" /><input id="phone" />
    <input id="phoneCountry" /><input id="phoneNational" />
    <input id="resume" />
  </form>
  <div id="snippetRows"></div><div id="templateRows"></div>
  <div id="expRows"></div><div id="eduRows"></div>
  <div id="profileSummary"></div><p id="status"></p>
  <input id="resumeFile" /><button id="clearResumeBtn"></button>
  <button id="profileRenameBtn"></button><button id="profileDupBtn"></button>
  <button id="profileDeleteBtn"></button><button id="saveBtn"></button>
  <button id="deleteAllBtn"></button>
</body></html>`;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(58)}: ${detail === undefined ? "" : String(detail) + " "}${
      cond ? "PASS" : "FAIL"
    }`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An options page backed by `store`, with the real UI scripts. */
function openOptions(store, opts) {
  const options = opts || {};
  const dom = new JSDOM(SHELL, { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.prompt = () => options.renameTo || "Renamed";
  const listeners = {};
  w.chrome = {
    storage: {
      local: {
        get: async (key) =>
          typeof key === "string" ? { [key]: store[key] } : Object.assign({}, store),
        set: async (obj) => Object.assign(store, obj),
        remove: async (keys) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            delete store[k];
          });
        }
      },
      onChanged: { addListener: (fn) => (listeners.changed = fn) }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: { query: async () => [{ id: 7 }], sendMessage: async () => ({ ok: false }) },
    scripting: { executeScript: async () => [{}] }
  };
  w.eval(
    POPUP_JS +
      "\n; window.__t = { loadProfiles, get profileState() { return profileState; }, " +
      "activeProfile, activateProfile, createProfileFromCurrent, createNewProfile, " +
      "duplicateProfile, renameProfile, deleteProfile, " +
      "renameActiveProfile, deleteActiveProfile, " +
      "refreshProfileSelect, loadProfile, saveProfile, readForm };"
  );
  const api = w.__t;
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, t: api, store, listeners };
}

const names = (popup) => popup.t.profileState.items.map((item) => item.name).join(",");
const statusText = (popup) => popup.d.getElementById("status").textContent;

(async () => {
  // ---- A. a v1 install is adopted, not thrown away -----------------------
  const store = { jobProfile: { firstName: "Jane", lastName: "Doe", email: "jane@example.com" } };
  const first = openOptions(store);
  await sleep(60);
  t("A: one profile appears", first.t.profileState.items.length === 1, first.t.profileState.items.length);
  t("A: named 'Default'", names(first) === "Default", names(first));
  t("A: and it is active", first.t.profileState.activeId === first.t.profileState.items[0].id);
  t(
    "A: it carries the existing data",
    first.t.profileState.items[0].profile.firstName === "Jane",
    first.t.profileState.items[0].profile.firstName
  );
  t("A: the list was persisted", !!store[PROFILES_KEY]);
  t("A: jobProfile is untouched", store[PROFILE_KEY].firstName === "Jane");
  t(
    "A: the picker is populated",
    first.d.getElementById("profileSelect").options.length === 1
  );

  // ---- B. saving an edit keeps the list in sync --------------------------
  first.d.getElementById("firstName").value = "Janet";
  await first.t.saveProfile();
  await sleep(30);
  t("B: the edit reached jobProfile", store[PROFILE_KEY].firstName === "Janet", store[PROFILE_KEY].firstName);
  t(
    "B: ...and the active profile in the list",
    store[PROFILES_KEY].items[0].profile.firstName === "Janet",
    store[PROFILES_KEY].items[0].profile.firstName
  );

  // ---- C. a second profile is a real copy --------------------------------
  const created = await first.t.createNewProfile(); // through the real button
  await sleep(40);
  t("C: a new profile exists", first.t.profileState.items.length === 2, names(first));
  t("C: named as asked", names(first) === "Default,Renamed", names(first));
  t("C: the new one is active", first.t.profileState.activeId === first.t.profileState.items[1].id);
  t(
    "C: the picker followed",
    first.d.getElementById("profileSelect").value === first.t.profileState.activeId,
    first.d.getElementById("profileSelect").value
  );
  t(
    "C: it started from the current values",
    first.t.activeProfile().profile.firstName === "Janet",
    first.t.activeProfile().profile.firstName
  );

  // ---- D. the two profiles are independent -------------------------------
  first.d.getElementById("firstName").value = "Bob";
  await first.t.saveProfile();
  await sleep(30);
  const list = store[PROFILES_KEY].items;
  t(
    "D: editing one profile leaves the other alone",
    list.find((i) => i.name === "Default").profile.firstName === "Janet" &&
      list.find((i) => i.name === "Renamed").profile.firstName === "Bob",
    list.map((i) => i.name + "=" + i.profile.firstName).join(" ")
  );

  // ---- E. resumes belong to a profile, and survive an edit ---------------
  store[PROFILE_KEY].resumeFile = {
    name: "frontend.pdf",
    type: "application/pdf",
    dataUrl: "data:application/pdf;base64,AAAA"
  };
  await first.t.loadProfile(); // the real flow after a profile switch
  await first.t.saveProfile();
  await sleep(30);
  t(
    "E: a save does not wipe the stored resume",
    !!store[PROFILE_KEY].resumeFile && store[PROFILE_KEY].resumeFile.name === "frontend.pdf",
    store[PROFILE_KEY].resumeFile && store[PROFILE_KEY].resumeFile.name
  );

  const withResume = await first.t.createProfileFromCurrent("Backend");
  await sleep(30);
  const backend = first.t.profileState.items.find((i) => i.id === withResume.id);
  t(
    "E: a new profile carries the resume it was made from",
    backend.profile.resumeFile.name === "frontend.pdf",
    backend.profile.resumeFile.name
  );

  // duplicateProfile must deep-copy, or editing one profile would silently
  // reach into the other through a shared object.
  const sourceId = first.t.profileState.items[0].id;
  const copy = await first.t.duplicateProfile(sourceId);
  const copyItem = first.t.profileState.items.find((i) => i.id === copy.id);
  t("E: duplicating names it as a copy", /copy$/.test(copyItem.name), copyItem.name);
  copyItem.profile.resumeFile = { name: "copy.pdf", type: "application/pdf", dataUrl: "y" };
  const originalResume = first.t.profileState.items.find((i) => i.id === sourceId).profile
    .resumeFile;
  t(
    "E: the copy is deep — editing it cannot reach the original",
    !originalResume || originalResume.name !== "copy.pdf",
    originalResume && originalResume.name
  );

  // ---- F. switching changes what the next fill uses ----------------------
  const defaultId = first.t.profileState.items.find((i) => i.name === "Default").id;
  const switched = await first.t.activateProfile(defaultId);
  await sleep(30);
  t("F: switching reports success", switched === true);
  t(
    "F: jobProfile now holds the OTHER profile",
    store[PROFILE_KEY].firstName === "Janet",
    store[PROFILE_KEY].firstName
  );
  t("F: the active id moved", store[PROFILES_KEY].activeId === defaultId);
  t(
    "F: both profiles still have their own data",
    store[PROFILES_KEY].items.find((i) => i.name === "Renamed").profile.firstName === "Bob",
    store[PROFILES_KEY].items.find((i) => i.name === "Renamed").profile.firstName
  );

  // ---- G. the picker drives the switch (real change event) ---------------
  const select = first.d.getElementById("profileSelect");
  select.value = first.t.profileState.items.find((i) => i.name === "Renamed").id;
  select.dispatchEvent(new first.w.Event("change"));
  await sleep(80);
  t("G: changing the picker switches profile", store[PROFILE_KEY].firstName === "Bob", store[PROFILE_KEY].firstName);
  t(
    "G: the form now shows the new profile",
    first.d.getElementById("firstName").value === "Bob",
    first.d.getElementById("firstName").value
  );
  t("G: and says so", /Now using/.test(statusText(first)), statusText(first));

  // ---- H. renaming -------------------------------------------------------
  const renaming = openOptions(
    { jobProfile: { firstName: "Jane" } },
    { renameTo: "Frontend" }
  );
  await sleep(60);
  await renaming.t.renameActiveProfile();
  await sleep(30);
  t("H: the profile is renamed", names(renaming) === "Frontend", names(renaming));
  t(
    "H: the picker shows the new name",
    renaming.d.getElementById("profileSelect").options[0].textContent === "Frontend",
    renaming.d.getElementById("profileSelect").options[0].textContent
  );
  t("H: the stored list agrees", renaming.store[PROFILES_KEY].items[0].name === "Frontend");

  // ---- I. deleting -------------------------------------------------------
  await renaming.t.createNewProfile();
  await sleep(40);
  t("I: two profiles to start", renaming.t.profileState.items.length === 2);
  await renaming.t.deleteActiveProfile();
  await sleep(40);
  t("I: one profile is gone", renaming.t.profileState.items.length === 1, names(renaming));
  t("I: the survivor is 'Frontend'", names(renaming) === "Frontend", names(renaming));
  t("I: and it is active", renaming.t.profileState.activeId === renaming.t.profileState.items[0].id);
  t(
    "I: jobProfile follows the survivor",
    renaming.store[PROFILE_KEY].firstName === "Jane",
    renaming.store[PROFILE_KEY].firstName
  );

  const last = await renaming.t.deleteActiveProfile();
  t("I: the last profile cannot be deleted", renaming.t.profileState.items.length === 1);
  t("I: and says why", /last profile cannot be deleted/.test(statusText(renaming)), statusText(renaming));

  // ---- J. the cap --------------------------------------------------------
  const many = openOptions({ jobProfile: { firstName: "Jane" } });
  await sleep(60);
  for (let i = 0; i < SHARED.maxProfiles + 3; i++) {
    await many.t.createNewProfile(); // through the real button
  }
  await sleep(30);
  t(
    "J: the list is capped",
    many.t.profileState.items.length === SHARED.maxProfiles,
    many.t.profileState.items.length
  );
  t("J: and says so", /At most/.test(statusText(many)), statusText(many));

  // ---- K. hand-edited storage cannot break the list ----------------------
  const junk = SHARED.sanitizeProfiles(
    {
      activeId: "missing",
      items: [
        { id: "a", name: "  Frontend  ", profile: { firstName: "Jane" } },
        { id: "a", name: "duplicate id", profile: { firstName: "Nobody" } },
        { id: "b", name: "", profile: { firstName: "Bob" } },
        { id: "c", name: "no profile here" },
        null
      ]
    },
    null
  );
  t("K: junk records are dropped", junk.items.length === 2, junk.items.length);
  t("K: a duplicate id is dropped", junk.items[0].profile.firstName === "Jane");
  t("K: names are trimmed", junk.items[0].name === "Frontend", junk.items[0].name);
  t("K: a missing name gets one", junk.items[1].name === "Untitled", junk.items[1].name);
  t(
    "K: an unknown active id falls back to the first",
    junk.activeId === "a",
    junk.activeId
  );
  t("K: no profiles at all is survivable", SHARED.sanitizeProfiles(null, null).items.length === 0);

  console.log(
    `\n${fail === 0 ? "PROFILES E2E PASS" : "PROFILES E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();
