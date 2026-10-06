// e2e21.js — optional broad host access (review #6).
//
// The gap: activeTab covers the page you clicked on, and host_permissions cover
// the ATS domains we pre-listed. If a career site embeds an ATS whose domain is
// NOT listed, that frame cannot be filled. The fix is an OPTIONAL permission the
// user can grant on demand. The guarantees under test:
//   1. nothing is requested until the user clicks;
//   2. the offer only appears when part of the page was genuinely unreachable;
//   3. an already-granted permission is not offered again;
//   4. there is no nagging when the page has no hidden frames.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP = "g:\\Programming\\Job Extension Project";
const { POPUP_JS } = require("./_popup-source");
const POPUP_HTML = fs.readFileSync(path.join(APP, "popup.html"), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(APP, "manifest.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(52)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}

/** Load the real popup against fake chrome APIs. */
function loadPopup(opts) {
  opts = opts || {};
  const dom = new JSDOM(POPUP_HTML, {
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message)));
  const calls = { request: [], contains: [] };

  window.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    scripting: { executeScript: async () => [{}, {}] },
    tabs: { query: async () => [{ id: 1 }], sendMessage: () => {} },
    permissions: {
      contains: async (p) => {
        calls.contains.push(p);
        return !!opts.alreadyGranted;
      },
      request: async (p) => {
        calls.request.push(p);
        return opts.granted !== false;
      }
    }
  };

  // popup.js is a classic script; hand its internals out from inside the eval.
  window.eval(
    POPUP_JS +
      "\n; window.__t = { aggregate, showGrantRow, requestAnySiteAccess };"
  );
  // jsdom has already fired DOMContentLoaded, so fire it again to run the
  // bootstrap (which is what wires the buttons).
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { window, document: window.document, calls, errors };
}

(async () => {
  // --- A. manifest + the offer appears only when it should -----------------
  t(
    "A: manifest declares optional_host_permissions",
    Array.isArray(MANIFEST.optional_host_permissions) &&
      MANIFEST.optional_host_permissions.indexOf("*://*/*") >= 0,
    JSON.stringify(MANIFEST.optional_host_permissions)
  );
  t(
    "A: <all_urls> is NOT a required host permission",
    (MANIFEST.host_permissions || []).indexOf("*://*/*") === -1
  );

  const a = loadPopup({ alreadyGranted: false });
  await sleep(60);
  const ad = a.document;
  t("A: popup loaded with no uncaught errors", a.errors.length === 0, a.errors[0] || "none");
  t("A: offer hidden by default", ad.getElementById("grantRow").hidden === true);
  t("A: nothing requested before a click", a.calls.request.length === 0);

  await a.window.__t.showGrantRow(true);
  t("A: offer shown for unreachable frames", ad.getElementById("grantRow").hidden === false);
  t("A: contains() consulted before offering", a.calls.contains.length > 0);
  t("A: still nothing requested without a click", a.calls.request.length === 0);

  // --- B. an already-granted permission is never offered twice ------------
  const b = loadPopup({ alreadyGranted: true });
  await sleep(60);
  await b.window.__t.showGrantRow(true);
  t(
    "B: hidden when permission already granted",
    b.document.getElementById("grantRow").hidden === true
  );

  // --- C. clicking actually requests the permission -----------------------
  const c = loadPopup({ alreadyGranted: false, granted: true });
  await sleep(60);
  await c.window.__t.showGrantRow(true);
  c.document
    .getElementById("grantBtn")
    .dispatchEvent(new c.window.MouseEvent("click", { bubbles: true }));
  await sleep(60);
  const requested = c.calls.request[0];
  t(
    "C: click requests *://*/*",
    !!requested && JSON.stringify(requested.origins) === JSON.stringify(["*://*/*"]),
    JSON.stringify(requested && requested.origins)
  );
  t(
    "C: status tells the user what to do next",
    /access granted/i.test(c.document.getElementById("status").textContent),
    c.document.getElementById("status").textContent
  );
  t("C: offer removed after granting", c.document.getElementById("grantRow").hidden === true);

  // --- D. a short fill on a framed page explains itself -------------------
  const d = loadPopup({ alreadyGranted: false });
  await sleep(60);
  const agg = d.window.__t.aggregate;
  agg.deadlineMs = 50;
  agg.start();
  agg.setExpected(1);
  agg.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 0,
    scanned: 9,
    iframes: 2,
    unfilled: []
  });
  agg.flush(false);
  await sleep(60);
  const dStatus = d.document.getElementById("status").textContent;
  t("D: unreachable frame explained in status", /could not reach/i.test(dStatus), dStatus);
  t("D: offer shown after the short fill", d.document.getElementById("grantRow").hidden === false);
  agg.cancel();

  // --- E. no nagging when the page has no hidden frames --------------------
  const e = loadPopup({ alreadyGranted: false });
  await sleep(60);
  const aggE = e.window.__t.aggregate;
  aggE.deadlineMs = 50;
  aggE.start();
  aggE.setExpected(1);
  aggE.add({
    type: "JOB_AUTOFILL_RESULT",
    status: "ok",
    filled: 3,
    scanned: 9,
    iframes: 0,
    unfilled: []
  });
  aggE.flush(false);
  await sleep(60);
  const eStatus = e.document.getElementById("status").textContent;
  t("E: offer stays hidden with no hidden frames", e.document.getElementById("grantRow").hidden === true);
  t("E: normal fill status unaffected", /Filled 3 fields/i.test(eStatus), eStatus);
  aggE.cancel();

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`OPTIONAL_HOST_ACCESS E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
