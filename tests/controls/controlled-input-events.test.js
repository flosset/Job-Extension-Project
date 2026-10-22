// controlled-input-events.test.js — how a value is written into a
// framework-controlled input.
//
// The reported bug (Ashby): the extension filled Email and LinkedIn, the text
// was visibly in the DOM, and the form still said
//   "Missing entry for required field: Email"
//   "Missing entry for required field: LinkedIn Profile (URL)"
// The value was written but React never learned about it.
//
// Guarantees under test:
//   1. writing a value fires `input` (the event React's onChange listens for);
//   2. it does NOT fire `blur` — a controlled form runs blur validation against
//      state that has not re-rendered yet, so it marks a visibly-filled field as
//      empty; it also tripped our own learner, whose capture-phase blur listener
//      would treat a scripted fill as the user typing;
//   3. the value survives a controlled component that resets the DOM node from
//      its own (still empty) state during the render the input event scheduled.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "dangerously",
  pretendToBeVisual: true
});
const { window } = dom;
const document = window.document;

window.Element.prototype.getClientRects = function () {
  return [{ width: 10, height: 10 }];
};
window.chrome = {
  storage: { local: { get: async () => ({}) } },
  runtime: { sendMessage: () => {} }
};

window.eval(SOURCE);
const JA = window.__JobAutofill;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(
    `${name} : ${JSON.stringify(actual)} ${ok ? "PASS" : "FAIL"}` +
      (ok ? "" : `   (expected ${JSON.stringify(expected)})`)
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeInput(attrs) {
  const el = document.createElement("input");
  el.type = "text";
  Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
  document.body.appendChild(el);
  return el;
}

(async () => {
  // --- 1/2. what a plain write dispatches -------------------------------
  const el = makeInput({ name: "email" });
  const fired = [];
  ["input", "change", "blur", "focusout"].forEach((type) => {
    el.addEventListener(type, () => fired.push(type));
  });

  JA.injectValue(el, "yash@example.com");

  check("1: the value is written", el.value, "yash@example.com");
  check("1: fires input (what React onChange reads)", fired.indexOf("input") !== -1, true);
  check("2: does NOT fire blur", fired.indexOf("blur"), -1);
  check("2: does NOT fire focusout", fired.indexOf("focusout"), -1);

  // --- 3. a controlled component resetting the node mid-render -----------
  // Simulates React re-rendering from its own stale (empty) state right after
  // the input event: the node is clobbered, and the fill must re-assert.
  const controlled = makeInput({ name: "linkedin" });
  let resets = 0;
  controlled.addEventListener("input", () => {
    // React has not committed our value yet, so its render writes "" back.
    if (resets === 0) {
      resets++;
      controlled.value = "";
    }
  });

  JA.injectValue(controlled, "https://www.linkedin.com/in/yash-s-246aa622b/");
  check("3: the clobber actually happened (test is meaningful)", resets, 1);
  // The reset is synchronous, inside the input handler, so the value is briefly
  // empty the instant injectValue returns. The re-assert lands on the next
  // frame — which is the guarantee that matters, checked below.
  check("3: value is empty right after the synchronous clobber",
    controlled.value, "");

  // The re-assert is scheduled on the next frame.
  await sleep(80);
  check("3: value survived the controlled reset",
    controlled.value, "https://www.linkedin.com/in/yash-s-246aa622b/");

  // --- 4. a widget that ALWAYS resets must not loop forever -------------
  // The retry is bounded to one attempt, so a permanently-empty field settles
  // rather than spinning.
  const stubborn = makeInput({ name: "never" });
  let writes = 0;
  stubborn.addEventListener("input", () => {
    writes++;
    stubborn.value = "";
  });
  JA.injectValue(stubborn, "x");
  await sleep(80);
  check("4: bounded retry (no infinite loop)", writes <= 3, true);

  // --- 5. the learner's blur listener is not triggered by a fill ---------
  // content/learning/answers.js watches `blur` in the capture phase to capture
  // what the USER types. A scripted fill must not look like typing. Writing
  // several fields in a row must not blur the previously written one either.
  let blurTargets = [];
  const watched = makeInput({ name: "question" });
  document.addEventListener("blur", (ev) => {
    blurTargets.push(ev.target === watched ? "watched" : "other");
  }, true);
  const first = makeInput({ name: "q1" });
  JA.injectValue(first, "one");
  JA.injectValue(watched, "two");
  check("5: a fill never reaches the learner's blur listener", blurTargets.length, 0);
  check("5: writing a second field does not steal focus",
    document.activeElement === watched, false);

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`CONTROLLED-INPUT E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
