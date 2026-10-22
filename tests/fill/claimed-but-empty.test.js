// claimed-but-empty.test.js — a field we filled and then LOST must be reported.
//
// Why this file exists: the reporter was worried that the fill might submit a
// BLANK value while the popup said nothing was left. That worry exposed a real
// hole. "Fields left for you" was built like this:
//
//     if (used.has(el)) continue;   // claimed by us: never reported again
//     if (JA.isFilled(el)) continue;
//
// so a field we claimed and then lost — a framework re-render, a portal quirk,
// or the validation nudge — was skipped by the ownership check and never
// reached the emptiness check. It vanished from the report, and the form would
// submit it blank. Exactly the silent failure the reporter feared.
//
// Guarantees under test:
//   1. a claimed field that is still filled is NOT reported (no regressions);
//   2. a claimed field that has been emptied IS reported;
//   3. an unclaimed empty field is still reported (unchanged behaviour);
//   4. the post-nudge repair puts a lost value back.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

const dom = new JSDOM(
  `<!doctype html><html><body>
     <label for="f-email">Email</label>
     <input id="f-email" type="email" name="email" />
     <label for="f-phone">Phone</label>
     <input id="f-phone" name="phone" />
   </body></html>`,
  { runScripts: "dangerously", pretendToBeVisual: true }
);
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

const email = document.getElementById("f-email");
const phone = document.getElementById("f-phone");
const labels = (used) => JA.report.collectUnfilled(used).map((e) => e.label);

// --- 1. a claimed field that still holds its value is not reported ------
const used = new Set();
JA.assignValue(email, "yashsaini590@gmail.com");
used.add(email);
check("1: a filled, claimed field is not reported",
  labels(used).some((l) => /email/i.test(l)), false);

// --- 2. THE HOLE: a claimed field that lost its value IS reported -------
email.value = ""; // the framework "took it back" after we claimed it
check("2: a claimed field that was emptied IS reported",
  labels(used).some((l) => /email/i.test(l)), true);

// --- 3. unclaimed empty fields are still reported (unchanged) ----------
check("3: an unclaimed empty field is still reported",
  labels(used).some((l) => /phone/i.test(l)), true);

// --- 4. the post-nudge repair restores what was lost -------------------
// This is the second pass content/autofill.js runs after the validation nudge.
// It must only fill EMPTY fields, so it repairs the loss above and leaves a
// present value alone.
const profile = { email: "restored@example.com", phone: "+1 555 123 4567" };
const pool = JA.fieldPool().filter(JA.isFillable);
let repaired = 0;
for (const key of Object.keys(JA.ATTRIBUTE_SELECTORS)) {
  const value = profile[key];
  if (!value) continue;
  const el = JA.matcher.pickField(key, pool, new Set());
  if (!el) continue;
  JA.assignValue(el, value);
  repaired++;
}
check("4: the repair pass refilled only what was lost", repaired, 2);
check("4: the emptied field is filled again", email.value, "restored@example.com");
check("4: nothing is now reported as left",
  labels(new Set()).filter((l) => /email|phone/i.test(l)).length, 0);

// --- 5. the repair never overwrites a present value --------------------
email.value = "hand-typed@example.com";
let second = 0;
for (const key of Object.keys(JA.ATTRIBUTE_SELECTORS)) {
  const value = profile[key];
  if (!value) continue;
  const el = JA.matcher.pickField(key, pool, new Set());
  if (!el) continue;
  JA.assignValue(el, value);
  second++;
}
check("5: a present value is not overwritten", email.value, "hand-typed@example.com");
check("5: the repair is a no-op when everything is filled", second, 0);

console.log("");
const verdict = fail === 0 ? "PASS" : "FAIL";
console.log(`CLAIMED-BUT-EMPTY E2E ${verdict} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
