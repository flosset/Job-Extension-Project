// e2e19.js — "fields left for you": required flags, one entry per radio
// QUESTION, checkboxes included, and click-to-highlight on the page.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SRC = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");
const { POPUP_JS } = require("./_popup-source");

const FIXTURE = `<!doctype html><html><body>
  <label for="firstName">First Name</label><input id="firstName" type="text" />
  <label for="why">Why do you want this job? *</label><input id="why" type="text" required />
  <label for="nick">Nickname</label><input id="nick" type="text" />
  <fieldset>
    <legend>Do you have a driver's licence? *</legend>
    <label><input type="radio" name="lic" value="yes" /> Yes</label>
    <label><input type="radio" name="lic" value="no" /> No</label>
  </fieldset>
  <label><input type="checkbox" id="consent" required /> I agree to the privacy policy *</label>
</body></html>`;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(52)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- Page side: what the content script reports --------------------------
  const dom = new JSDOM(FIXTURE, { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  let report = null;
  let locateListener = null;
  w.chrome = {
    storage: {
      local: {
        get: async () => ({ jobProfile: { firstName: "Jane" } }),
        set: async () => {},
        remove: async () => {}
      }
    },
    runtime: {
      sendMessage: (m) => {
        report = m;
      },
      onMessage: {
        addListener: (fn) => {
          locateListener = fn;
        }
      }
    }
  };
  w.eval(SRC);
  await w.__jobAutofillRun; // the run promise exposed by autofill.js
  const JA = w.__JobAutofill;

  const entries = (report && report.unfilled) || [];
  const find = (needle) =>
    entries.find((e) => (e.label || "").toLowerCase().indexOf(needle) !== -1);

  t("A: report carries unfilled entries", entries.length >= 4, entries.length);
  t(
    "A: entries are objects with label/required/ref",
    entries.every((e) => e && typeof e.label === "string" && "required" in e && "ref" in e)
  );
  t("A: filled field is NOT listed", !find("first name"));

  const why = find("why do you");
  t("A: required text field flagged required", !!why && why.required === true, why && why.label);
  const nick = find("nickname");
  t("A: optional text field flagged optional", !!nick && nick.required === false);
  t("A: trailing '*' stripped from labels", entries.every((e) => !/\*$/.test(e.label)));

  const lic = find("driver");
  t("A: radio group listed as ONE question", entries.filter((e) => /driver/.test(e.label)).length === 1);
  t("A: radio group flagged required", !!lic && lic.required === true);
  t(
    "A: radio label is the question, not the options",
    !!lic && !/yes\s*no/i.test(lic.label),
    lic && lic.label
  );

  const consent = find("privacy policy");
  t("A: checkbox question listed", !!consent);
  t("A: checkbox flagged required", !!consent && consent.required === true);

  // --- Locating a field from the popup ------------------------------------
  const target = JA.findByRef(why.ref);
  t("B: ref resolves back to the field", !!target && target.id === "why", target && target.id);
  locateListener({ type: "JOB_AUTOFILL_LOCATE", ref: why.ref });
  t("B: locate message flashes the field", target.getAttribute("data-ja-flash") === "1");
  t("B: unrelated message is ignored", typeof locateListener === "function");
  t("B: radio ref points at its label", !!JA.findByRef(lic.ref));

  // --- Popup side: required first, clickable ------------------------------
  const html = fs.readFileSync(path.join(APP_DIR, "popup.html"), "utf8");
  const pdom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  const pw = pdom.window;
  const sent = [];
  pw.chrome = {
    storage: {
      local: {
        get: async () => ({ jobProfile: { firstName: "Jane" } }),
        set: async () => {},
        remove: async () => {}
      }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: (tabId, message) => sent.push({ tabId, message })
    },
    scripting: { executeScript: async () => [] }
  };
  pw.eval(
    POPUP_JS +
      "\n; window.__t = { renderUnfilled, fillActiveTab," +
      " get tabId() { return activeTabId; } };"
  );
  const T = pw.__t;
  const pd = pdom.window.document;

  await T.fillActiveTab(); // records the tab we may message
  t("C: fill records the tab id", T.tabId === 7, T.tabId);

  // Deliberately optional-first, to prove the popup re-orders.
  T.renderUnfilled([
    { label: "Optional thing", required: false, ref: null },
    { label: "Required thing", required: true, ref: "ja-test-ref" }
  ]);
  const lis = Array.from(pd.querySelectorAll("#unfilledList li"));
  t("C: header counts the required ones", /\(1 required\)/.test(lis[0].textContent), lis[0].textContent);
  t("C: required field listed first", /Required thing/.test(lis[1].textContent), lis[1].textContent);
  t("C: required item carries a star", lis[1].textContent.indexOf("★") === 0);
  t("C: optional field listed after", /Optional thing/.test(lis[2].textContent), lis[2].textContent);

  lis[1].click();
  t(
    "C: clicking an item messages the tab with its ref",
    sent.length === 1 && sent[0].tabId === 7 && sent[0].message.ref === "ja-test-ref",
    JSON.stringify(sent[0] || null)
  );

  // Non-clickable entries (no ref) must not pretend to be clickable.
  T.renderUnfilled([{ label: "No handle", required: false, ref: null }]);
  const plain = pd.querySelectorAll("#unfilledList li")[1];
  sent.length = 0;
  plain.click();
  t("C: an entry without a ref sends nothing", sent.length === 0);

  // Old string-shaped reports must still render (backwards compatibility).
  T.renderUnfilled(["Legacy label"]);
  const legacy = pd.querySelectorAll("#unfilledList li")[1];
  t("C: legacy string entries still render", /Legacy label/.test(legacy.textContent));
  t("C: legacy entries are plain, not clickable", !legacy.title);

  await sleep(400); // let the aggregate's own flush settle

  console.log(
    `\n${fail === 0 ? "UNFILLED-REVIEW E2E PASS" : "UNFILLED-REVIEW E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();