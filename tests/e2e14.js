// e2e14.js — the popup's run-completion model. Regression under test: a frame
// that reports LATE (after the old 300 ms quiet gap) used to be silently
// dropped. Completion is now defined as "every frame executeScript injected
// into has reported", with a hard deadline that surfaces non-responding frames.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const { POPUP_JS: SRC } = require("./_popup-source");

const dom = new JSDOM(
  `<!doctype html><html><body>
     <div id="status"></div><ul id="unfilledList"></ul>
     <button id="saveBtn"></button><button id="fillBtn"></button>
     <button id="addSnippetBtn"></button><button id="addExpBtn"></button>
     <button id="addEduBtn"></button>
     <input id="resumeFile" /><button id="clearResumeBtn"></button>
   </body></html>`,
  { runScripts: "dangerously", pretendToBeVisual: true }
);
const { window } = dom;
const document = window.document;

window.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
  tabs: { query: async () => [] },
  scripting: { executeScript: async () => [] }
};

// Top-level `const`s in (indirect) eval are scoped to that eval, so hand the
// object we need back out from inside the same evaluation.
window.eval(SRC + "\n; window.__test = { aggregate };");
const agg = window.__test.aggregate;

const status = () => document.getElementById("status").textContent;
const listText = () => document.getElementById("unfilledList").textContent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feed = (o) => agg.add(Object.assign({ type: "JOB_AUTOFILL_RESULT" }, o));

let pass = 0;
let fail = 0;
function t(name, cond) {
  cond ? pass++ : fail++;
  console.log(`${name} : ${cond ? "PASS" : "FAIL"}`);
}

(async () => {
  // popup.js wires a DOMContentLoaded bootstrap that runs loadProfile(); in
  // jsdom that fires asynchronously just after eval and would clobber the
  // status line mid-test. Wait for boot to settle before exercising aggregate.
  await sleep(150);

  // T1 — the reported bug: a frame replying long after the others.
  agg.start();
  agg.setExpected(3);
  feed({ status: "ok", filled: 1 });
  feed({ status: "ok", filled: 2 });
  await sleep(600); // far longer than the old 300 ms quiet gap
  t("T1 waits past the old quiet gap (no premature render)", /Scanning/.test(status()));
  t("T1 shows live frame progress 2/3", /\(2\/3 /.test(status()));
  t("T1 run still active", agg.active === true);
  feed({ status: "ok", filled: 4 });
  await sleep(450);
  t("T1 renders once every frame replied", /Filled 7 fields/.test(status()));
  t("T1 run finished", agg.active === false);

  // T2 — messages may arrive before the frame count is known.
  agg.start();
  feed({ status: "ok", filled: 5 });
  await sleep(500);
  t("T2 does not render while the frame count is unknown", agg.active === true);
  agg.setExpected(1);
  await sleep(450);
  t("T2 renders as soon as the count arrives", /Filled 5 fields/.test(status()));

  // T3 — hard deadline covers a frame that never answers.
  agg.deadlineMs = 400;
  agg.start();
  agg.setExpected(3);
  feed({ status: "ok", filled: 2 });
  await sleep(900);
  t("T3 deadline still renders the frames that DID answer", /Filled 2 fields/.test(status()));
  t("T3 shortfall is surfaced, not hidden", /2 frames did not respond/.test(status()));
  t("T3 run finished", agg.active === false);

  // T4 — a frame that was still busy is not an error.
  agg.deadlineMs = 15000;
  agg.start();
  agg.setExpected(2);
  feed({ status: "busy" });
  feed({ status: "ok", filled: 3 });
  t("T4 busy frame flagged as busy", agg.results.sawBusy === true);
  t("T4 busy frame is NOT an error", agg.results.sawError === false);
  await sleep(450);
  t("T4 renders the successful frame", /Filled 3 fields/.test(status()));

  // T5 — unfilled labels merge across frames and de-duplicate.
  agg.start();
  agg.setExpected(2);
  feed({ status: "ok", filled: 1, unfilled: ["City", "State"] });
  feed({ status: "ok", filled: 1, unfilled: ["State", "Zip"] });
  await sleep(450);
  const text = listText();
  t(
    "T5 unfilled merged + deduped (City/State/Zip, State once)",
    text.indexOf("City") !== -1 &&
      text.indexOf("Zip") !== -1 &&
      (text.match(/State/g) || []).length === 1
  );

  // T6 — a straggler arriving after the run closed must not resurrect it.
  agg.start();
  agg.setExpected(1);
  feed({ status: "ok", filled: 1 });
  await sleep(450);
  t("T6 renders once the single frame replied", /Filled 1 field/.test(status()));
  feed({ status: "ok", filled: 99 });
  await sleep(120);
  t("T6 straggler after completion is ignored", /Filled 1 field/.test(status()));

  console.log(
    `\n${fail === 0 ? "COMPLETION E2E PASS" : "COMPLETION E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();
