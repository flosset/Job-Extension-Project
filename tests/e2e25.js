// e2e25.js — the application tracker.
//
//   * what company/role get read off a posting (JSON-LD, page title, and the
//     deliberate refusal to invent a company from the ATS hostname),
//   * that a fill logs it, once, with a date,
//   * that a repeat application is caught BEFORE the form is filled again,
//   * that re-pressing Fill in the same sitting is NOT a second application,
//   * and that the log is user data (delete-all removes it).
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, POPUP_JS, SHARED } = require("./_popup-source");

const APPS_KEY = SHARED.keys.applications;

// page-info.js only needs the data table and the DOM helpers.
const INFO_SRC = ["shared.js", "content/field-map.js", "content/dom-utils.js", "content/page-info.js"]
  .map((file) => fs.readFileSync(path.join(APP_DIR, file), "utf8"))
  .join("\n");

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

/** The job info a given page reports. */
function infoFor(html, url) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: url || "https://boards.greenhouse.io/acme/jobs/123"
  });
  const w = dom.window;
  w.eval(INFO_SRC);
  return w.__JobAutofill.pageInfo();
}

// --- the popup side ---------------------------------------------------------

const POPUP_SHELL = `<!doctype html><html><body>
  <div id="profileRow"><select id="profileSelect"></select></div>
  <p id="status"></p><ul id="unfilledList"></ul>
  <div id="coverSection" hidden><select id="coverTemplate"></select>
    <p id="coverNote"></p><pre id="coverPreview"></pre></div>
  <div id="grantRow" hidden></div>
  <div id="learnedSection" hidden><div id="learnedRows"></div></div>
  <button id="fillBtn"></button><button id="saveBtn"></button>
  <input id="resumeFile" /><button id="clearResumeBtn"></button>
</body></html>`;

function openPopup(store, opts) {
  const options = opts || {};
  const tabs = options.tabs || [{ id: 7, title: "Engineer - Acme", url: "https://acme.com/j/1" }];
  const dom = new JSDOM(POPUP_SHELL, { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.prompt = () => "Renamed";
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
      }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: { query: async () => tabs, sendMessage: async () => ({ ok: false }) },
    scripting: { executeScript: async () => new Array(options.frames || 1).fill({}) }
  };
  w.eval(
    POPUP_JS +
      "\n; window.__t = { aggregate, fillActiveTab, restoreRun, loadApplications, " +
      "previousApplication, recordApplication, " +
      // A getter: the module REASSIGNS this binding when it reloads the log.
      "get applicationState() { return applicationState; }, " +
      "describeApplication, formatWhen, applicationsCsv, setApplicationStatus, " +
      "deleteApplication, clearApplications, renderApplications };"
  );
  const api = w.__t;
  api.aggregate.graceMs = 20;
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, t: api, store };
}

const statusText = (p) => p.d.getElementById("status").textContent;

/** Run one fill that reports `page`, and settle. */
async function fillWith(popup, page, extra) {
  await popup.t.fillActiveTab();
  popup.t.aggregate.add(
    Object.assign(
      { type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 3, frames: 1, iframes: 0, scanned: 9, page },
      extra || {}
    )
  );
  await sleep(90);
}

/** Open a fresh popup on `tabId` and let its restore settle. */
async function reopened(store, tabId) {
  const popup = openPopup(store, {
    tabs: [{ id: tabId, title: "Engineer - Acme", url: "https://acme.com/j/1" }]
  });
  await sleep(70);
  return popup;
}

(async () => {
  // ---- A. what a posting tells us ----------------------------------------
  const ld = infoFor(
    `<html><head><title>Careers</title>
       <script type="application/ld+json">
         {"@context":"https://schema.org","@type":"JobPosting",
          "title":"Senior Frontend Engineer",
          "hiringOrganization":{"@type":"Organization","name":"Acme Corp"}}
       </script></head><body><h1>Apply now</h1></body></html>`
  );
  t("A: JSON-LD gives the company", ld.company === "Acme Corp", ld.company);
  t("A: JSON-LD gives the role", ld.role === "Senior Frontend Engineer", ld.role);
  t("A: JSON-LD is marked authoritative", ld.confident === true);
  t("A: the URL is recorded", /greenhouse\.io/.test(ld.url), ld.url);

  const titled = infoFor(
    `<html><head><title>Staff Backend Engineer - Globex | Greenhouse</title></head>
     <body><h1>Staff Backend Engineer</h1></body></html>`
  );
  t("A: the role comes from the title", titled.role === "Staff Backend Engineer", titled.role);
  t("A: the company comes from the title", titled.company === "Globex", titled.company);
  t("A: the board is never the company", titled.company !== "Greenhouse");

  const at = infoFor(
    `<html><head><title>Data Scientist at Initech</title></head><body></body></html>`
  );
  t(
    "A: 'Role at Company' splits",
    at.role === "Data Scientist" && at.company === "Initech",
    at.role + "/" + at.company
  );

  const hostOnly = infoFor(
    `<html><head><title>Job Application</title></head><body><h1>Apply</h1></body></html>`,
    "https://boards.greenhouse.io/acme/jobs/9"
  );
  t(
    "A: with only the ATS hostname, the company stays EMPTY",
    hostOnly.company === "",
    hostOnly.company
  );
  t(
    "A: ...but the host is still recorded",
    hostOnly.host === "boards.greenhouse.io",
    hostOnly.host
  );

  const ogTitle = infoFor(
    `<html><head><title>Careers</title>
       <meta property="og:title" content="Product Designer - Umbrella Corp" />
     </head><body></body></html>`
  );
  t(
    "A: og:title is a fallback",
    ogTitle.role === "Product Designer" && ogTitle.company === "Umbrella Corp",
    ogTitle.role + "/" + ogTitle.company
  );

  // ---- B. a fill logs the application ------------------------------------
  const store = {};
  const popup = openPopup(store);
  await sleep(40);
  const page = {
    company: "Acme Corp",
    role: "Senior Frontend Engineer",
    url: "https://acme.com/j/1",
    host: "acme.com"
  };
  await fillWith(popup, page);

  const logged = store[APPS_KEY];
  t("B: the fill wrote an application log", !!logged && Array.isArray(logged.items));
  t("B: exactly one row", logged.items.length === 1, logged.items.length);
  t("B: with the company", logged.items[0].company === "Acme Corp", logged.items[0].company);
  t("B: with the role", logged.items[0].role === "Senior Frontend Engineer");
  t("B: with a date", typeof logged.items[0].at === "number" && logged.items[0].at > 0);
  t("B: status starts at 'applied'", logged.items[0].status === "applied", logged.items[0].status);
  t("B: counted once", logged.items[0].times === 1, logged.items[0].times);
  t(
    "B: the popup says it logged it",
    /Logged to your applications/.test(statusText(popup)),
    statusText(popup)
  );
  t("B: no duplicate warning on a first application", !/Already applied/.test(statusText(popup)));

  // ---- C. the same sitting is not a second application -------------------
  await fillWith(popup, page);
  t(
    "C: re-filling in the same sitting does not inflate 'times'",
    store[APPS_KEY].items[0].times === 1,
    store[APPS_KEY].items[0].times
  );
  t(
    "C: and it does not warn about its own row",
    !/Already applied/.test(statusText(popup)),
    statusText(popup)
  );

  // ---- D. a genuine repeat is caught -------------------------------------
  const old = Date.now() - 6 * 60 * 60 * 1000; // six hours ago
  store[APPS_KEY] = {
    items: [
      {
        id: "x1",
        company: "Globex",
        role: "Staff Backend Engineer",
        url: "https://globex.com/j/2",
        at: old,
        lastAt: old,
        times: 1,
        status: "applied"
      }
    ]
  };
  const repeat = openPopup(store);
  await sleep(40);
  await fillWith(repeat, {
    company: "globex inc.",
    role: "staff backend engineer",
    url: "https://globex.com/j/2?utm=1",
    host: "globex.com"
  });
  t(
    "D: the repeat is warned about",
    /Already applied here on/.test(statusText(repeat)),
    statusText(repeat)
  );
  t("D: no second row was added", store[APPS_KEY].items.length === 1, store[APPS_KEY].items.length);
  t(
    "D: 'times' counted the second application",
    store[APPS_KEY].items[0].times === 2,
    store[APPS_KEY].items[0].times
  );
  t(
    "D: the original spelling is kept",
    store[APPS_KEY].items[0].company === "Globex",
    store[APPS_KEY].items[0].company
  );
  t(
    "D: the warning survives reopening the popup",
    /Already applied here on/.test(statusText(await reopened(store, 7))),
    statusText(await reopened(store, 7))
  );

  // ---- E. a different role at the same company is NOT a duplicate --------
  const other = openPopup(store);
  await sleep(40);
  await fillWith(other, {
    company: "Globex",
    role: "Product Manager",
    url: "https://globex.com/j/3",
    host: "globex.com"
  });
  t("E: a different role is a new application", store[APPS_KEY].items.length === 2, store[APPS_KEY].items.length);
  t("E: and is not warned about", !/Already applied/.test(statusText(other)), statusText(other));

  // ---- F. what is NOT an application -------------------------------------
  const blank = openPopup({});
  await sleep(40);
  await blank.t.fillActiveTab();
  blank.t.aggregate.add({ type: "JOB_AUTOFILL_RESULT", status: "empty" });
  await sleep(90);
  t("F: a page with no profile logs nothing", !blank.store[APPS_KEY]);

  const noForm = openPopup({});
  await sleep(40);
  await noForm.t.fillActiveTab();
  noForm.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 0,
    scanned: 0,
    frames: 1,
    page: { company: "Nobody", role: "Nothing" }
  });
  await sleep(90);
  t("F: a page with no form logs nothing", !noForm.store[APPS_KEY]);

  const noPage = openPopup({});
  await sleep(40);
  await fillWith(noPage, null);
  t("F: a page with no job info logs nothing", !noPage.store[APPS_KEY]);

  // ---- G. the log as data -------------------------------------------------
  const csv = popup.t.applicationsCsv();
  t("G: the CSV has a header", /^company,role,status,applied,last,times,url/.test(csv), csv.split("\r\n")[0]);
  t("G: the CSV quotes values", /"Acme Corp"/.test(csv));
  t("G: rows follow the header", csv.split("\r\n").length >= 2);

  const first = popup.t.applicationState.items[0];
  await popup.t.setApplicationStatus(first.id, "interview");
  t("G: a status can be set", popup.t.applicationState.items[0].status === "interview");
  t(
    "G: an unknown status is refused",
    (await popup.t.setApplicationStatus(first.id, "nonsense")) === false
  );

  await popup.t.deleteApplication(first.id);
  t("G: a row can be removed", popup.t.applicationState.items.length === 0);
  await popup.t.clearApplications();
  t(
    "G: the log can be cleared",
    popup.t.applicationState.items.length === 0 &&
      (popup.store[APPS_KEY].items || []).length === 0
  );

  // ---- H. the log is user data -------------------------------------------
  t(
    "H: the popup lists the log under its own storage key",
    SHARED.keys.applications === "applications",
    SHARED.keys.applications
  );
})();