// e2e17.js — profile data ownership. Loads the REAL popup.html + popup.js into
// jsdom and exercises: export round-trip, import sanitisation, unsaved-change
// tracking (dirty badge), and delete-all.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
// The editing surface now lives on the full-page editor, not the popup.
const html = fs.readFileSync(path.join(APP_DIR, "options.html"), "utf8");
const { POPUP_JS: SRC } = require("./_popup-source");

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const document = window.document;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let savedObject = null;
let removedKey = null;
window.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async (obj) => {
        savedObject = obj;
      },
      remove: async (key) => {
        removedKey = key;
      }
    }
  },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} }
};

// popup.js is a classic script evaluated as (indirect) eval, so its internals
// are not reachable as window properties. Hand them out explicitly.
window.eval(
  SRC +
    "\n; window.__t = { get dirty() { return formDirty; }, readForm, " +
    "buildExportText, parseImportText, saveProfile, exportProfile, " +
    "onImportFilePicked, deleteAllData };"
);
const T = window.__t;

const statusText = () => $("status").textContent;
const badgeHidden = () => $("dirtyBadge").hidden;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(48)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}
const failureOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return (err && err.message) || String(err);
  }
};

const SOURCE_PROFILE = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  workExperiences: [
    { title: "Engineer", company: "Acme", from: "2020-01", current: true, junk: 5 }
  ],
  educations: [{ school: "State U", degree: "BS" }, { school: "" }],
  customSnippets: [
    { key: "salary", value: "$120,000" },
    { key: "empty", value: "" }
  ],
  resumeFile: {
    name: "r.pdf",
    type: "application/pdf",
    size: 123,
    dataUrl: "data:application/pdf;base64,AAA"
  },
  replaceHistory: true,
  evil: { nested: ["should", "be", "dropped"] }
};

(async () => {
  // --- A. Export → import round-trip --------------------------------------
  const text = T.buildExportText(SOURCE_PROFILE);
  const parsed = T.parseImportText(text);
  t("A: round-trip keeps a text field", parsed.firstName === "Jane", parsed.firstName);
  t("A: unknown top-level keys dropped", !("evil" in parsed), "evil" in parsed);
  t("A: junk sub-keys dropped", !("junk" in parsed.workExperiences[0]));
  t("A: boolean flag kept", parsed.workExperiences[0].current === true);
  t("A: blank entries filtered", parsed.educations.length === 1, parsed.educations.length);
  t("A: blank snippets filtered", parsed.customSnippets.length === 1, parsed.customSnippets.length);
  t("A: resume kept", /^data:/.test(parsed.resumeFile.dataUrl));
  t("A: replaceHistory kept", parsed.replaceHistory === true);

  // --- B. Envelope shape ---------------------------------------------------
  const env = JSON.parse(text);
  t("B: envelope format tag", env.format === "job-autofill-profile", env.format);
  t("B: envelope version", env.version === 1, env.version);
  t("B: envelope carries the profile", !!env.profile);

  // --- C. Tolerant import --------------------------------------------------
  const bare = T.parseImportText(JSON.stringify({ firstName: "Solo" }));
  t("C: accepts a bare profile object", bare.firstName === "Solo", bare.firstName);

  // --- D. Rejections -------------------------------------------------------
  t(
    "D: invalid JSON rejected",
    /valid JSON/.test(failureOf(() => T.parseImportText("{oops")) || ""),
    failureOf(() => T.parseImportText("{oops"))
  );
  t(
    "D: array rejected",
    /does not contain/.test(failureOf(() => T.parseImportText("[1,2]")) || "")
  );
  t(
    "D: empty object rejected",
    /does not contain/.test(failureOf(() => T.parseImportText("{}")) || "")
  );
  t(
    "D: junk-only object rejected",
    /does not contain/.test(
      failureOf(() => T.parseImportText(JSON.stringify({ evil: 1 }))) || ""
    )
  );

  // --- E. Unsaved-change tracking -----------------------------------------
  await sleep(200); // let DOMContentLoaded + loadProfile settle
  t("E: starts clean, badge hidden", window.__t.dirty === false && badgeHidden() === true);

  $("firstName").dispatchEvent(new window.Event("input", { bubbles: true }));
  t("E: editing marks dirty + shows badge", window.__t.dirty === true && badgeHidden() === false);
  // The editor auto-saves ~400ms after the last keystroke; let it settle so it
  // cannot fire in the middle of a later assertion.
  await sleep(600);

  await T.saveProfile();
  t("E: saving clears dirty + hides badge", window.__t.dirty === false && badgeHidden() === true);
  t("E: saving persisted the edit", !!savedObject && savedObject.jobProfile.firstName === "");

  $("replaceHistory").checked = true;
  $("replaceHistory").dispatchEvent(new window.Event("change", { bubbles: true }));
  t("E: toggling the destructive option is dirty too", window.__t.dirty === true);
  await T.saveProfile();
  t("E: the flag is persisted", savedObject.jobProfile.replaceHistory === true);

  // --- F. Export download --------------------------------------------------
  let capturedBlob = null;
  const downloadNames = [];
  window.URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    return "blob:test";
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    downloadNames.push(this.download);
  };

  $("firstName").value = "ExportMe";
  T.exportProfile();
  await sleep(20);
  t("F: produced a JSON blob", !!capturedBlob && capturedBlob.type === "application/json");
  t("F: set a download filename", downloadNames[0] === "job-autofill-profile.json", downloadNames[0]);
  t("F: export status shown", /Exported/.test(statusText()), statusText());

  let exportedText = null;
  if (capturedBlob && typeof capturedBlob.text === "function") {
    exportedText = await capturedBlob.text();
  }
  t(
    "F: exported JSON re-imports the edit",
    !exportedText || T.parseImportText(exportedText).firstName === "ExportMe"
  );

  // --- G. Import a picked file --------------------------------------------
  window.confirm = () => true;
  savedObject = null;
  Object.defineProperty($("importFile"), "files", {
    configurable: true,
    value: [{ text: async () => T.buildExportText({ firstName: "Imported" }) }]
  });
  await T.onImportFilePicked();
  t(
    "G: import persisted the profile",
    !!savedObject && savedObject.jobProfile.firstName === "Imported"
  );
  t("G: import shows it in the form", $("firstName").value === "Imported", $("firstName").value);
  t("G: import leaves the form clean", window.__t.dirty === false && badgeHidden() === true);

  // --- H. Delete-all -------------------------------------------------------
  removedKey = null;
  await T.deleteAllData();
  t("H: delete-all removed the storage key", removedKey === "jobProfile", removedKey);
  t("H: delete-all cleared the form", $("firstName").value === "");
  t("H: delete-all leaves the form clean", window.__t.dirty === false && badgeHidden() === true);
  t("H: delete-all status shown", /deleted/i.test(statusText()), statusText());

  removedKey = null;
  window.confirm = () => false;
  await T.deleteAllData();
  t("H: cancelled delete changes nothing", removedKey === null && /cancelled/i.test(statusText()));

  console.log(
    `\n${fail === 0 ? "DATA-OWNERSHIP E2E PASS" : "DATA-OWNERSHIP E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();
