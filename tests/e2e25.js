// e2e25.js â€” the application tracker.
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
  <div id="appRows"></div>
  <div id="askJob" hidden><p id="askNote"></p>
    <input id="askCompany" /><input id="askRole" />
    <button id="askSaveBtn"></button><button id="askSkipBtn"></button></div>
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
      "setApplicationName, deleteApplication, clearApplications, renderApplications, " +
      "showJobAsk, hideJobAsk, saveJobAsk, dismissJobAsk, " +
      "get jobAsk() { return jobAsk; }, markAskAnswered, readRuns };"
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

  const slugOnly = infoFor(
    `<html><head><title>Job Application</title></head><body><h1>Apply</h1></body></html>`,
    "https://boards.greenhouse.io/acme/jobs/9"
  );
  t("A: the URL's own slug is a last-resort company", slugOnly.company === "Acme", slugOnly.company);
  t("A: ...and the host is recorded too", slugOnly.host === "boards.greenhouse.io", slugOnly.host);

  const noSlug = infoFor(
    `<html><head><title>Job Application</title></head><body><h1>Apply</h1></body></html>`,
    "https://boards.greenhouse.io/embed/job_app?for=acme"
  );
  t("A: ...but a structure word is never a company", noSlug.company === "", JSON.stringify(noSlug.company));

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
  t("B: status starts as 'in progress'", logged.items[0].status === "in progress", logged.items[0].status);
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
  t(
    "G: a record with no status sanitises to 'in progress'",
    SHARED.sanitizeApplications({ items: [{ company: "X", role: "Y" }] }).items[0]
      .status === "in progress"
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

  // ---- I. how the NAME is found ------------------------------------------
  const logo = infoFor(
    `<html><head><title>Apply</title></head><body>
       <img src="x.png" alt="Acme Corporation logo" />
     </body></html>`,
    "https://jobs.example.com/apply/9"
  );
  t("I: the logo alt text names the employer", logo.company === "Acme Corporation", logo.company);

  const vendorLogo = infoFor(
    `<html><head><title>Apply</title></head><body>
       <img src="x.png" alt="Greenhouse logo" />
     </body></html>`,
    "https://jobs.example.com/apply/9"
  );
  t("I: a board's own logo is not the employer", vendorLogo.company === "", vendorLogo.company);

  const vendorLogoRealBoard = infoFor(
    `<html><head><title>Apply</title></head><body>
       <img src="x.png" alt="Greenhouse logo" />
     </body></html>`,
    "https://boards.greenhouse.io/acme/jobs/9"
  );
  t(
    "I: ...even on that board, where the URL still names the employer",
    vendorLogoRealBoard.company === "Acme",
    vendorLogoRealBoard.company
  );

  const vendorSite = infoFor(
    `<html><head>
       <title>Apply</title>
       <meta property="og:site_name" content="Greenhouse" />
     </head><body><img src="x.png" alt="Umbrella Corp logo" /></body></html>`,
    "https://boards.greenhouse.io/acme/jobs/9"
  );
  t(
    "I: a vendor og:site_name is SKIPPED, not the end of the chain",
    vendorSite.company === "Umbrella Corp",
    vendorSite.company
  );

  const noLogo = infoFor(
    `<html><head><title>Apply</title></head><body><img src="x.png" alt="Team photo" /></body></html>`,
    "https://jobs.example.com/apply/9"
  );
  t("I: an ordinary image alt is not a company", noLogo.company === "", JSON.stringify(noLogo.company));

  // ---- K. other boards: where the employer is named in the URL -----------
  const boardUrl = (url, html) =>
    infoFor(html || `<html><head><title>Apply</title></head><body></body></html>`, url);

  const workday = boardUrl(
    "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer_JR123"
  );
  t("K: Workday's tenant subdomain names the employer", workday.company === "Nvidia", workday.company);

  const workdayTitled = boardUrl(
    "https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/London/Data-Engineer_R-1",
    `<html><head><title>Data Engineer - Acme</title></head><body></body></html>`
  );
  t(
    "K: a Workday page that DOES name itself wins over the URL",
    workdayTitled.company === "Acme",
    workdayTitled.company
  );

  for (const [label, url, expected] of [
    ["Lever", "https://jobs.lever.co/globex/abc-123", "Globex"],
    ["Greenhouse (new domain)", "https://job-boards.greenhouse.io/umbrella/jobs/4", "Umbrella"],
    ["Workable", "https://apply.workable.com/initech/j/ABC123/", "Initech"],
    ["SmartRecruiters", "https://jobs.smartrecruiters.com/Hooli/7440000", "Hooli"],
    ["Ashby", "https://jobs.ashbyhq.com/dunder-mifflin/abc", "Dunder Mifflin"],
    ["Taleo", "https://acme.taleo.net/careersection/2/moresearch.ftl", "Acme"],
    ["iCIMS", "https://careers-acme.icims.com/jobs/1234/engineer/job", "Acme"],
    ["BambooHR", "https://acme.bamboohr.com/careers/42", "Acme"],
    ["Jobvite", "https://jobs.jobvite.com/wayne-enterprises/job/x", "Wayne Enterprises"]
  ]) {
    const info = boardUrl(url);
    t(`K: ${label} â€” the URL names the employer`, info.company === expected, info.company);
  }

  // The guesses that must NOT happen: a structure word, or a tenant id.
  for (const [label, url] of [
    ["a Greenhouse EMBED url", "https://boards.greenhouse.io/embed/job_app?for=acme&token=x"],
    ["a tenant environment id", "https://career5.successfactors.eu/career?company=acme"],
    ["an ordinary website", "https://www.example.com/careers/apply"],
    ["a jobs landing page", "https://jobs.example.com/"]
  ]) {
    const info = boardUrl(url);
    t(`K: ${label} yields no company`, info.company === "", JSON.stringify(info.company));
  }

  const siteWord = boardUrl(
    "https://acme.wd1.myworkdayjobs.com/en-US/x/job/y/Engineer_R-2",
    `<html><head><title>Engineer - NVIDIA Careers</title></head><body></body></html>`
  );
  t("K: a trailing site word is stripped from the company", /^nvidia$/i.test(siteWord.company) || siteWord.company === "Acme", siteWord.company);

  // ---- J. the row is editable, and the layout cannot collapse -----------
  const rows = openPopup({});
  await sleep(60);
  await rows.t.recordApplication({
    company: "",
    role: "",
    url: "https://jobs.lever.co/embed/job_app",
    host: "jobs.lever.co"
  });
  rows.t.renderApplications();
  const row = rows.d.querySelector("#appRows .app-row");
  t("J: a row is rendered", !!row);
  t(
    "J: with an editable company and role",
    !!row.querySelector(".app-company") && !!row.querySelector(".app-role")
  );
  t(
    "J: the date applied is shown",
    /\d{4}/.test(row.querySelector(".app-meta").textContent),
    row.querySelector(".app-meta").textContent.trim()
  );
  t(
    "J: the host is shown when the name is unknown",
    /jobs\.lever\.co/.test(row.querySelector(".app-meta").textContent)
  );
  t(
    "J: a nameless row is still identifiable on hover",
    /jobs\.lever\.co/.test(row.getAttribute("title") || ""),
    row.getAttribute("title")
  );
  t(
    "J: only a row with nothing at all says 'Unknown company'",
    rows.t.describeApplication({}) === "Unknown company",
    rows.t.describeApplication({})
  );

  // Fill means you STARTED an application, not that you submitted it. The row
  // must say so, and one click is how you say you submitted it.
  t(
    "J: a fresh row is 'in progress', not 'applied'",
    row.querySelector(".app-status").value === "in progress",
    row.querySelector(".app-status").value
  );
  const markBtn = row.querySelector(".app-mark");
  t("J: with a one-click 'Mark applied' button", !!markBtn);
  if (markBtn) markBtn.click();
  await sleep(30);
  t(
    "J: which records the application as applied",
    rows.store[APPS_KEY].items[0].status === "applied",
    rows.store[APPS_KEY].items[0].status
  );
  t(
    "J: and the button is gone once applied",
    !rows.d.querySelector("#appRows .app-row .app-mark")
  );

  // Typing a name fixes the row â€” the answer to "the page never told us".
  const companyBox = row.querySelector(".app-company");
  const roleBox = row.querySelector(".app-role");
  companyBox.value = "Initech";
  companyBox.dispatchEvent(new rows.w.Event("change"));
  roleBox.value = "Data Scientist";
  roleBox.dispatchEvent(new rows.w.Event("change"));
  await sleep(30);
  const saved = rows.store[APPS_KEY].items[0];
  t("J: the typed company is stored", saved.company === "Initech", saved.company);
  t("J: the typed role is stored", saved.role === "Data Scientist", saved.role);
  t(
    "J: and it survives a reload of the log",
    (await rows.t.loadApplications(), rows.t.applicationState.items[0].company === "Initech")
  );

  // The reported bug: the global `select { width: 100% }` stretched the row's
  // status control and squeezed the name to zero width.
  const css = fs.readFileSync(path.join(APP_DIR, "ui.css"), "utf8");
  const ruleFor = (selector) => {
    const found = css.match(
      new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}")
    );
    return found ? found[1] : "";
  };
  t(
    "J: the row's status control is not full width",
    /width:\s*auto/.test(ruleFor(".app-status")) && /flex:\s*0 0 auto/.test(ruleFor(".app-status")),
    ruleFor(".app-status").trim()
  );
  t(
    "J: the name column cannot be squeezed away",
    /min-width/.test(ruleFor(".app-main")) && /flex:\s*1 1 auto/.test(ruleFor(".app-main")),
    ruleFor(".app-main").trim()
  );
  t(
    "J: the name inputs override the global width too",
    /width:\s*auto/.test(ruleFor(".app-name input")),
    ruleFor(".app-name input").trim()
  );

  // ---- L. it ASKS when the page could not name the job -------------------
  // A posting with no company anywhere: the fill logs a row, and the popup asks
  // rather than filing something nameless.
  const nameless = openPopup({});
  await sleep(50);
  await nameless.t.fillActiveTab();
  nameless.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 1,
    scanned: 1,
    frames: 1,
    page: { company: "", role: "", url: "https://jobs.example.com/apply/9", host: "jobs.example.com" }
  });
  await sleep(120);

  const askBox = () => nameless.d.getElementById("askJob");
  t("L: a nameless job is logged anyway", !!nameless.store[APPS_KEY], JSON.stringify(Object.keys(nameless.store)));
  t("L: and the popup asks", askBox().hidden === false);
  t("L: the question names what is missing", /company and the role/.test(nameless.d.getElementById("askNote").textContent), nameless.d.getElementById("askNote").textContent);

  // The popup closes on any click, so the question must come back on reopen.
  const reopenedAsk = openPopup(nameless.store);
  await sleep(80);
  t("L: the question survives closing the popup", reopenedAsk.d.getElementById("askJob").hidden === false);

  // Answering it fills in the row this fill already created (no second row).
  const askCompany = reopenedAsk.d.getElementById("askCompany");
  const askRole = reopenedAsk.d.getElementById("askRole");
  askCompany.value = "Initech";
  askRole.value = "Data Scientist";
  reopenedAsk.d.getElementById("askSaveBtn").click();
  await sleep(60);
  t("L: saving writes it into the existing row", nameless.store[APPS_KEY].items.length === 1, nameless.store[APPS_KEY].items.length);
  t("L: the company is stored", nameless.store[APPS_KEY].items[0].company === "Initech", nameless.store[APPS_KEY].items[0].company);
  t("L: the role is stored", nameless.store[APPS_KEY].items[0].role === "Data Scientist");
  t("L: the question closes", reopenedAsk.d.getElementById("askJob").hidden === true);
  t("L: and says so", /Saved to your applications/.test(reopenedAsk.d.getElementById("status").textContent));

  const afterAnswer = openPopup(nameless.store);
  await sleep(80);
  t("L: reopening after answering does NOT ask again", afterAnswer.d.getElementById("askJob").hidden === true);

  // "Not now" stops the nagging without writing anything.
  const skipped = openPopup({});
  await sleep(50);
  await skipped.t.fillActiveTab();
  skipped.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 1,
    scanned: 1,
    frames: 1,
    page: { company: "", role: "", url: "https://jobs.example.com/apply/10", host: "jobs.example.com" }
  });
  await sleep(120);
  t("L: it asks on a fresh page", skipped.d.getElementById("askJob").hidden === false);
  skipped.d.getElementById("askSkipBtn").click();
  await sleep(60);
  t("L: 'Not now' closes it", skipped.d.getElementById("askJob").hidden === true);
  t("L: 'Not now' still left a row", skipped.store[APPS_KEY].items.length === 1);
  t("L: 'Not now' wrote no name", skipped.store[APPS_KEY].items[0].company === "");
  const skippedAgain = openPopup(skipped.store);
  await sleep(80);
  t("L: and it does not ask again this run", skippedAgain.d.getElementById("askJob").hidden === true);

  // ---- M. a job the page DID name is never asked about ------------------
  const known = openPopup({});
  await sleep(50);
  await fillWith(known, { company: "Acme Corp", role: "Senior Dev", url: "https://acme.com/j/1", host: "acme.com" });
  t("M: no question when both are known", known.d.getElementById("askJob").hidden === true);
  t("M: nothing to save", known.t.jobAsk === null);

  // A half-known job asks for exactly the missing half, prefilled.
  const half = openPopup({});
  await sleep(50);
  await half.t.fillActiveTab();
  half.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 1,
    scanned: 1,
    frames: 1,
    page: { company: "Nvidia", role: "", url: "https://nvidia.wd5.myworkdayjobs.com/x/y/z", host: "nvidia.wd5.myworkdayjobs.com" }
  });
  await sleep(120);
  t("M: a half-known job is still logged with what we have", half.store[APPS_KEY].items[0].company === "Nvidia");
  t("M: and it asks for the missing half", half.d.getElementById("askJob").hidden === false);
  t("M: naming only what is missing", /didn't give us the role/.test(half.d.getElementById("askNote").textContent), half.d.getElementById("askNote").textContent);
  t("M: the known half is prefilled", half.d.getElementById("askCompany").value === "Nvidia", half.d.getElementById("askCompany").value);
  t("M: the missing half starts empty", half.d.getElementById("askRole").value === "");

  console.log(
    `\n${fail === 0 ? "TRACKER E2E PASS" : "TRACKER E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();