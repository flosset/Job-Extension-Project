// unfilled-survives.test.js — "N fields left for you" must survive the popup closing.
//
// The reported bug: the list was rendered ONLY from the live fill messages, and
// the popup is a brand-new document every time it opens — so the list vanished
// the moment it closed, which is precisely when the user needs it, because they
// close the popup to go and fill those fields by hand.
//
// The fix stores each finished run per tab and rebuilds the list on the next
// open, for the tab you are actually on.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { POPUP_JS, SHARED } = require("./_popup-source");

const RUNS_KEY = SHARED.keys.runs;

// The popup's shell, with the pieces the UI touches (it is all null-safe).
const STRIP = `<!doctype html><html><body>
  <div id="grantRow" hidden><button id="grantBtn"></button></div>
  <p id="status"></p>
  <ul id="unfilledList"></ul>
  <div id="learnedSection" hidden><p id="learnedNote"></p><div id="learnedRows"></div></div>
  <button id="saveLearnedAllBtn"></button><button id="dismissLearnedAllBtn"></button>
  <button id="fillBtn"></button><button id="editProfileBtn"></button>
  <button id="saveBtn"></button><button id="exportBtn"></button>
  <input id="resumeFile" /><button id="clearResumeBtn"></button>
</body></html>`;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(58)}: ${
      detail === undefined ? "" : String(detail) + " "
    }${cond ? "PASS" : "FAIL"}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A popup document backed by `store`, with the real UI scripts. */
function openPopup(store, opts) {
  const options = opts || {};
  const sent = [];
  const tabs = options.tabs || [{ id: 7 }];
  const dom = new JSDOM(STRIP, { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
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
    tabs: {
      query: async () => tabs,
      sendMessage: async (tabId, message) => {
        sent.push({ tabId, message });
        if (options.sendFails) {
          throw new Error("Could not establish connection.");
        }
      }
    },
    scripting: { executeScript: async () => new Array(options.frames || 1).fill({}) }
  };
  w.eval(
    POPUP_JS +
      "\n; window.__t = { aggregate, fillActiveTab, restoreRun, saveRun, readRuns };"
  );
  const api = w.__t;
  api.aggregate.graceMs = 20; // no need to wait 250ms per render
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, t: api, sent };
}

const listText = (p) => p.d.getElementById("unfilledList").textContent;
const statusText = (p) => p.d.getElementById("status").textContent;
const items = (p) => Array.from(p.d.querySelectorAll("#unfilledList li"));

(async () => {
  // ---- A. a finished run is remembered, per tab ---------------------------
  const store = {};
  const popup = openPopup(store, { frames: 2 });
  await sleep(30);
  await popup.t.fillActiveTab(); // records the tab we may message + starts the run
  popup.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 3, frames: 1, iframes: 0, scanned: 9,
    unfilled: [
      { label: "City", required: true, ref: "ja-1" },
      { label: "State", required: false, ref: "ja-2" }
    ]
  });
  popup.t.aggregate.add({
    type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 2, frames: 1, iframes: 0, scanned: 4,
    unfilled: [{ label: "Zip", required: false, ref: "ja-3" }]
  });
  await sleep(90);

  t(
    "A: the live run renders the list",
    /City/.test(listText(popup)) && /Zip/.test(listText(popup))
  );
  const saved = (store[RUNS_KEY] || {})["7"];
  t("A: the finished run is stored under its tab", !!saved, Object.keys(store[RUNS_KEY] || {}).join(","));
  t(
    "A: with the merged unfilled list",
    !!saved && saved.results.unfilled.length === 3,
    saved && saved.results.unfilled.length
  );
  t("A: and the time it happened", !!saved && typeof saved.at === "number" && saved.at > 0);

  // ---- B. a brand-new popup rebuilds it ----------------------------------
  const reopened = openPopup(store); // same storage, fresh document
  await sleep(60);
  t(
    "B: the list is back after reopening the popup",
    /City/.test(listText(reopened)) && /Zip/.test(listText(reopened)),
    listText(reopened)
  );
  t(
    "B: the required field is still listed first",
    /★ City/.test(items(reopened)[1].textContent),
    items(reopened)[1].textContent
  );
  t(
    "B: the status says where it came from",
    /after your fill at/.test(statusText(reopened)),
    statusText(reopened)
  );
  t(
    "B: and how to refresh it",
    /press Fill Application to re-check/.test(statusText(reopened))
  );
  t(
    "B: the header still counts what is left",
    /3 fields left for you/.test(items(reopened)[0].textContent),
    items(reopened)[0].textContent
  );

  // ---- C. only the tab you are actually on -------------------------------
  store[RUNS_KEY]["9"] = {
    tabId: 9,
    at: Date.now(),
    results: {
      unfilled: [{ label: "OtherTabField", required: false, ref: "ja-9" }],
      frames: 1,
      iframes: 0
    }
  };
  const otherTab = openPopup(store, { tabs: [{ id: 9 }] });
  await sleep(60);
  t("C: another tab's run is not shown on this one", !/OtherTabField/.test(listText(reopened)));
  t("C: ...but it is shown on its own tab", /OtherTabField/.test(listText(otherTab)), listText(otherTab));

  // ---- D. clicking a restored entry still works --------------------------
  items(reopened)[1].click();
  await sleep(30);
  t(
    "D: clicking sends the stored handle to the right tab",
    reopened.sent.length === 1 && reopened.sent[0].tabId === 7,
    JSON.stringify(reopened.sent[0] || null)
  );
  t("D: with the handle that field had", reopened.sent[0].message.ref === "ja-1", reopened.sent[0].message.ref);

  const dead = openPopup(store, { sendFails: true });
  await sleep(60);
  items(dead)[1].click();
  await sleep(40);
  t(
    "D: a page that changed says so instead of looking dead",
    /page has changed since the fill/.test(statusText(dead)),
    statusText(dead)
  );

  // ---- E. nothing to show is not the same as showing nothing stale -------
  const blank = openPopup({}, {});
  await sleep(60);
  t(
    "E: a tab with no remembered run shows nothing",
    listText(blank) === "" && statusText(blank) === "",
    JSON.stringify(statusText(blank))
  );

  const staleStore = {
    [RUNS_KEY]: {
      "7": {
        tabId: 7,
        at: Date.now() - (SHARED.runMaxAgeMs + 60000),
        results: {
          unfilled: [{ label: "Ancient", required: false, ref: "ja-x" }],
          frames: 1,
          iframes: 0
        }
      }
    }
  };
  const stale = openPopup(staleStore);
  await sleep(60);
  t("E: a stale run is not restored", listText(stale) === "", listText(stale));

  // ---- F. the stored runs cannot grow forever ----------------------------
  const pruneStore = {};
  const pruner = openPopup(pruneStore);
  await sleep(40);
  for (let i = 1; i <= 6; i++) {
    await pruner.t.saveRun(i, {
      unfilled: [{ label: "T" + i, required: false, ref: "ja-" + i }],
      frames: 1,
      iframes: 0
    });
  }
  const runKeys = Object.keys(pruneStore[RUNS_KEY] || {});
  t("F: remembered runs are capped", runKeys.length === SHARED.maxRuns, runKeys.length);
  t("F: the run just written is always kept", runKeys.indexOf("6") >= 0, runKeys.join(","));

  pruneStore[RUNS_KEY]["42"] = {
    tabId: 42,
    at: Date.now() - (SHARED.runMaxAgeMs + 60000),
    results: { unfilled: [{ label: "Old", required: false, ref: "ja-o" }], frames: 1, iframes: 0 }
  };
  await pruner.t.saveRun(7, { unfilled: [], frames: 1, iframes: 0 });
  t(
    "F: an expired run is pruned on the next save",
    !("42" in pruneStore[RUNS_KEY]) && "7" in pruneStore[RUNS_KEY],
    Object.keys(pruneStore[RUNS_KEY]).join(",")
  );

  console.log(
    `\n${
      fail === 0 ? "UNFILLED-SURVIVES E2E PASS" : "UNFILLED-SURVIVES E2E FAIL"
    } (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();

