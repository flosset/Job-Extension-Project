// button-pair-safety.test.js — the guarantee that makes button clicking acceptable.
//
// Ashby renders a Yes/No question as TWO <button type="submit"> elements:
//
//   <label for="…">Are you currently legally authorized to work in the US?</label>
//   <div class="…input-yesno">
//     <button type="submit" aria-pressed="false">Yes</button>
//     <button type="submit" aria-pressed="false">No</button>
//   </div>
//
// So "never press the submit button" CANNOT be implemented by excluding
// type="submit" — the Yes/No buttons ARE submit buttons. The guarantee has to
// be structural instead, and this file pins it:
//
//   1. the extension only ever clicks a button that is one of an ANCHORED pair
//      (exactly two, polarity-opposite, inside a labelled container);
//   2. while it clicks, any form submission is cancelled, so even a pair that
//      lives inside a <form> cannot submit;
//   3. a lone "Submit Application" button is never a candidate, and never
//      offered for learning.
//
// Guarantee 2 is the real one. 1 and 3 are defence in depth.
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

/** Build the exact Ashby shape: a label, then a div holding two Yes/No buttons. */
function buildYesNo(question, insideForm) {
  const host = insideForm ? document.createElement("form") : document.createElement("div");
  if (insideForm) document.body.appendChild(host);

  const field = document.createElement("div");
  field.className = "fieldEntry";
  const label = document.createElement("label");
  label.className = "question-title";
  label.textContent = question;
  const box = document.createElement("div");
  box.className = "input-yesno";
  ["Yes", "No"].forEach((t) => {
    const b = document.createElement("button");
    b.type = "submit";                 // the awkward truth
    b.setAttribute("aria-pressed", "false");
    b.textContent = t;
    b.addEventListener("click", () => {
      box.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
    });
    box.appendChild(b);
  });
  field.appendChild(label);
  field.appendChild(box);
  host.appendChild(field);
  if (!insideForm) document.body.appendChild(host);
  return { field, label, box, buttons: Array.from(box.querySelectorAll("button")), host };
}

(async () => {
  // --- 1. a lone Submit button is not a pair -----------------------------
  const lone = document.createElement("button");
  lone.type = "submit";
  lone.textContent = "Submit Application";
  document.body.appendChild(lone);

  check("1: a lone Submit button is not recognised as a pair",
    JA.yesNoPairFor ? JA.yesNoPairFor(lone) : "NO API", null);

  // --- 2. a real pair is recognised, and only the pair -------------------
  const a = buildYesNo("Are you currently legally authorized to work in the US?");
  const pairA = JA.yesNoPairFor ? JA.yesNoPairFor(a.buttons[0]) : "NO API";
  check("2: the Yes button belongs to a recognised pair", !!pairA, true);
  check("2: the pair exposes exactly two buttons",
    pairA && pairA.buttons ? pairA.buttons.length : -1, 2);
  check("2: the pair exposes its question text",
    pairA && /legally authorized/i.test(pairA.question || ""), true);

  // --- 3. THE GUARANTEE: clicking never submits --------------------------
  const b = buildYesNo("Are you available to work full-time for the co-op?", true);
  let submitted = false;
  b.host.addEventListener("submit", (e) => { submitted = true; e.preventDefault(); });
  // Also catch a submit that escapes to the document (what a real page would do).
  document.addEventListener("submit", () => { submitted = true; });

  JA.chooseYesNo(b.buttons, "Yes");
  check("3: the Yes button was actually pressed",
    b.buttons[0].getAttribute("aria-pressed"), "true");
  check("3: NO form submission happened", submitted, false);

  // --- 4. the guard is removed afterwards (no lingering page-wide effect) -
  const stray = document.createElement("form");
  const strayBtn = document.createElement("button");
  strayBtn.type = "submit";
  strayBtn.textContent = "Submit Application";
  stray.appendChild(strayBtn);
  document.body.appendChild(stray);
  let straySubmitted = false;
  stray.addEventListener("submit", (e) => { straySubmitted = true; e.preventDefault(); });
  strayBtn.click();
  check("4: an unrelated Submit still works after our click", straySubmitted, true);

  // --- 5. negation safety carries over from the radio path ---------------
  const c = buildYesNo("Are you authorized to work without sponsorship?");
  check("5: 'Yes' selects the Yes button",
    (JA.chooseYesNo(c.buttons, "Yes"), c.buttons[0].getAttribute("aria-pressed")), "true");
  check("5: 'No' selects the No button",
    (JA.chooseYesNo(c.buttons, "No"), c.buttons[1].getAttribute("aria-pressed")), "true");

  // --- 6. a non-Yes/No button pair is refused ----------------------------
  const other = document.createElement("div");
  other.className = "actions";
  ["Save draft", "Submit"].forEach((t) => {
    const btn = document.createElement("button");
    btn.textContent = t;
    other.appendChild(btn);
  });
  document.body.appendChild(other);
  const otherBtn = other.querySelector("button");
  check("6: a Save/Submit button pair is not a Yes/No pair",
    JA.yesNoPairFor ? JA.yesNoPairFor(otherBtn) : null, null);

  // --- 7. polarity safety: 'Yes' must not land on a negative option ------
  const d = buildYesNo("Are you NOT authorized to work in the US?");
  // Deliberately build a pair whose options are both negative-ish.
  d.buttons[0].textContent = "I am not authorized";
  d.buttons[1].textContent = "I am not authorized either";
  const picked = JA.chooseYesNo(d.buttons, "Yes");
  check("7: a Yes answer is refused when no option agrees", picked, false);

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`BUTTON-PAIR-SAFETY E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
