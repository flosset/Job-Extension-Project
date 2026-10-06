// e2e18.js — split UI: full-page editor (options.html) vs compact popup.
// The critical guarantee under test: a page that shows only PART of the profile
// may only write the parts it shows — saving from the popup must never wipe the
// fields that now live on the options page.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const { POPUP_JS } = require("./_popup-source");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(50)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}

/** Load one of the extension's pages against a shared fake storage. */
function loadPage(file, seed) {
  const html = fs.readFileSync(path.join(APP_DIR, file), "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message)));

  const storage = { [seed.key]: seed.profile };
  const writes = [];
  window.chrome = {
    storage: {
      local: {
        get: async (k) => (k in storage ? { [k]: storage[k] } : {}),
        set: async (obj) => {
          writes.push(obj);
          Object.assign(storage, obj);
        },
        remove: async (k) => {
          delete storage[k];
        }
      }
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      openOptionsPage: () => {
        window.__openedOptions = true;
      }
    },
    scripting: { executeScript: async () => [] },
    tabs: { query: async () => [] }
  };

  // popup.js is a classic script; hand its internals out from inside the eval.
  window.eval(
    POPUP_JS +
      "\n; window.__t = { get dirty() { return formDirty; }," +
      " readForm, saveProfile, autoSave };"
  );
  return { window, document: window.document, storage, writes, errors };
}

const FULL = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "+1 555 123 4567",
  workExperiences: [{ title: "Engineer", company: "Acme", from: "2020-01" }],
  educations: [{ school: "State U", degree: "BS" }],
  customSnippets: [{ key: "salary", value: "$120,000" }],
  resumeFile: { name: "jane.pdf", type: "application/pdf", size: 10, dataUrl: "data:x" },
  replaceHistory: false
};

(async () => {
  // --- A. The full editor loads cleanly and owns every field --------------
  const opts = loadPage("options.html", { key: "jobProfile", profile: FULL });
  await sleep(220);
  const od = opts.document;
  t("A: options page marked data-page=options", od.body.dataset.page === "options");
  t("A: loads with no uncaught errors", opts.errors.length === 0, opts.errors[0] || "none");
  t("A: firstName filled from storage", od.getElementById("firstName").value === "Jane");
  t(
    "A: all profile fields present",
    ["firstName", "desiredSalary", "country", "disability", "sponsorship"].every(
      (id) => !!od.getElementById(id)
    )
  );
  t("A: no Fill button on the editor", !od.getElementById("fillBtn"));
  t(
    "A: summary line rendered",
    /Jane Doe/.test(od.getElementById("profileSummary").textContent),
    od.getElementById("profileSummary").textContent
  );

  // --- B. The editor auto-saves as you type ------------------------------
  opts.writes.length = 0;
  const first = od.getElementById("firstName");
  first.value = "Janet";
  first.dispatchEvent(new opts.window.Event("input", { bubbles: true }));
  await sleep(650); // past AUTOSAVE_MS (400)
  t("B: auto-saved without pressing Save", opts.writes.length === 1, opts.writes.length);
  t(
    "B: auto-save kept the whole profile",
    opts.writes.length > 0 &&
      opts.writes[0].jobProfile.firstName === "Janet" &&
      opts.writes[0].jobProfile.workExperiences.length === 1 &&
      opts.writes[0].jobProfile.resumeFile.name === "jane.pdf"
  );
  t(
    "B: status shows it saved",
    /Saved/.test(od.getElementById("status").textContent),
    od.getElementById("status").textContent
  );
  t("B: form is clean again", opts.window.__t.dirty === false);

  // --- C. The compact popup cannot wipe what it does not show -------------
  const pop = loadPage("popup.html", { key: "jobProfile", profile: FULL });
  await sleep(220);
  const pd = pop.document;
  t("C: popup loads with no uncaught errors", pop.errors.length === 0, pop.errors[0] || "none");
  t("C: popup has no editing grid", !pd.getElementById("lastName"));
  t(
    "C: popup summary shows name + resume",
    /Jane Doe/.test(pd.getElementById("profileSummary").textContent) &&
      /jane\.pdf/.test(pd.getElementById("profileSummary").textContent),
    pd.getElementById("profileSummary").textContent
  );

  pop.writes.length = 0;
  const box = pd.getElementById("replaceHistory");
  box.checked = true;
  box.dispatchEvent(new pop.window.Event("change", { bubbles: true }));
  await sleep(80);
  t(
    "C: toggling the flag persisted it",
    pop.writes.length === 1 && pop.writes[0].jobProfile.replaceHistory === true,
    pop.writes.length
  );
  const after = pop.writes.length ? pop.writes[0].jobProfile : {};
  t("C: hidden text field survived", after.firstName === "Jane" && after.lastName === "Doe");
  t("C: hidden arrays survived", after.workExperiences.length === 1 && after.educations.length === 1);
  t("C: hidden snippets survived", after.customSnippets.length === 1);
  t("C: hidden resume survived", after.resumeFile && after.resumeFile.name === "jane.pdf");
  t("C: hidden scalar survived", after.phone === "+1 555 123 4567");

  // --- D. The popup hands you to the full editor --------------------------
  pd.getElementById("editProfileBtn").click();
  t("D: Edit profile opens the options page", pop.window.__openedOptions === true);

  // --- E. Manifest + files ------------------------------------------------
  const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, "manifest.json"), "utf8"));
  t(
    "E: manifest points at options.html",
    !!(manifest.options_ui && manifest.options_ui.page === "options.html")
  );
  t("E: options page opens in a tab", manifest.options_ui.open_in_tab === true);
  t("E: options.html exists on disk", fs.existsSync(path.join(APP_DIR, "options.html")));
  t("E: ui.css exists on disk", fs.existsSync(path.join(APP_DIR, "ui.css")));

  console.log(
    `\n${fail === 0 ? "SPLIT-UI E2E PASS" : "SPLIT-UI E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();
