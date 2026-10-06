// e2e13.js — negation-safe answer matching. The guarantee under test: a stored
// "Yes" must NEVER land on an option or radio that reads "I am not
// authorized ...", and when nothing agrees the field is left BLANK rather
// than answered wrongly. Exercises the shared matcher directly against
// native <select>, radio groups and react-select options.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SOURCE = [
  "content/field-map.js",
  "content/dom-utils.js",
  "content/combobox.js",
  "content/fill.js",
  "content/dates.js",
  "content/repeatable.js",
  "content/radios.js",
  "content/files.js",
  "content/autofill.js"
]
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

// --- native <select> -------------------------------------------------------
function makeSelect(options) {
  const sel = document.createElement("select");
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select...";
  sel.appendChild(ph);
  options.forEach(([value, text]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  });
  document.body.appendChild(sel);
  return sel;
}
function chosenText(select, value) {
  const option = JA.findOptionForValue(select, value);
  return option ? option.textContent : "(blank)";
}

// 1. The reviewer's exact case: the NEGATIVE option is listed first.
const wa = makeSelect([
  ["wa1", "I am not authorized to work in the US"],
  ["wa2", "I am authorized to work in the US"]
]);
check("select  Yes skips 'not authorized' (bad order)", chosenText(wa, "Yes"), "I am authorized to work in the US");
check("select  No picks 'not authorized'", chosenText(wa, "No"), "I am not authorized to work in the US");

// 2. Only the opposite option exists -> blank, never mis-answered.
const onlyNeg = makeSelect([["a", "I am not authorized to work in the US"]]);
check("select  Yes with only a negative option -> blank", chosenText(onlyNeg, "Yes"), "(blank)");
const onlyPos = makeSelect([["b", "I am authorized to work in the US"]]);
check("select  No with only a positive option -> blank", chosenText(onlyPos, "No"), "(blank)");

// 3. Veteran: sub-categories are NOT the protected-veteran answer.
const vet = makeSelect([
  ["d", "Disabled veteran"],
  ["aw", "Active duty wartime or campaign badge veteran"],
  ["n", "I am not a protected veteran"],
  ["y", "I am a protected veteran"]
]);
check("select  protected veteran -> right option", chosenText(vet, "I am a protected veteran"), "I am a protected veteran");
check("select  not a protected veteran", chosenText(vet, "I am not a protected veteran"), "I am not a protected veteran");
const vetSub = makeSelect([["aw", "Active duty wartime or campaign badge veteran"]]);
check("select  sub-category only -> blank (no narrowing)", chosenText(vetSub, "I am a protected veteran"), "(blank)");

// 4. Disability, verbose labels, negative listed first.
const dis = makeSelect([
  ["dn", "No, I do not have a disability"],
  ["dy", "Yes, I have a disability"]
]);
check("select  disability Yes", chosenText(dis, "Yes, I have a disability"), "Yes, I have a disability");
check("select  disability No", chosenText(dis, "No, I do not have a disability"), "No, I do not have a disability");

// 5. Decline must beat "No".
const dec = makeSelect([["y", "Yes"], ["n", "No"], ["d", "Decline to self-identify"]]);
check("select  prefer not to say -> decline", chosenText(dec, "Prefer not to say"), "Decline to self-identify");
check("select  Yes still picks Yes from that list", chosenText(dec, "Yes"), "Yes");

// 6. Sponsorship with statement-style options (no machine yes/no values, so
//    the TEXT has to carry the polarity).
const spon = makeSelect([
  ["s1", "I will require sponsorship"],
  ["s2", "I do not require sponsorship"]
]);
check("select  sponsorship No", chosenText(spon, "No"), "I do not require sponsorship");
check("select  sponsorship Yes", chosenText(spon, "Yes"), "I will require sponsorship");

// 7. Regressions: non-boolean answers are unaffected.
const gender = makeSelect([["man", "Man"], ["woman", "Woman"], ["nb", "Non-binary"]]);
check("regress gender Male -> Man", chosenText(gender, "Male"), "Man");
const state = makeSelect([["tx", "Texas"], ["ca", "California"]]);
check("regress state TX -> Texas", chosenText(state, "TX"), "Texas");
const degree = makeSelect([["bs", "Bachelor's Degree"], ["ms", "Master's Degree"]]);
check("regress degree BS -> Bachelor's", chosenText(degree, "BS"), "Bachelor's Degree");
const notice = makeSelect([["i", "Immediately"], ["2", "2 weeks"], ["4", "4 weeks"]]);
check("regress notice '2 weeks' (no polarity)", chosenText(notice, "2 weeks"), "2 weeks");

// --- radio groups ---------------------------------------------------------
function makeRadioGroup(question, labels, name) {
  const wrap = document.createElement("div");
  const q = document.createElement("div");
  q.textContent = question;
  wrap.appendChild(q);
  const radios = labels.map((label, i) => {
    const lab = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = String(i);
    lab.appendChild(input);
    lab.appendChild(document.createTextNode(" " + label));
    wrap.appendChild(lab);
    return input;
  });
  document.body.appendChild(wrap);
  return radios;
}
function radioLabel(radios, value) {
  const picked = JA.radioOptionFor(radios, value);
  if (!picked) return "(blank)";
  const lab = picked.closest("label");
  return lab ? lab.textContent.trim() : "(?)";
}

// 8. Plain Yes/No radios.
const r1 = makeRadioGroup("Are you legally authorized to work in the US?", ["Yes", "No"], "authq");
check("radio   plain Yes", radioLabel(r1, "Yes"), "Yes");
check("radio   plain No", radioLabel(r1, "No"), "No");

// 9. THE inversion: verbose labels, negative listed first.
const r2 = makeRadioGroup(
  "Are you legally authorized to work in the US?",
  ["I am not authorized to work in the US", "I am authorized to work in the US"],
  "waq"
);
check("radio   Yes picks the affirmative label", radioLabel(r2, "Yes"), "I am authorized to work in the US");
check("radio   No picks the negative label", radioLabel(r2, "No"), "I am not authorized to work in the US");

// 10. Sponsorship question with statement radios.
const r3 = makeRadioGroup(
  "Will you now or in the future require sponsorship?",
  ["Yes, I will require sponsorship", "No, I do not require sponsorship"],
  "sponq"
);
check("radio   sponsorship No", radioLabel(r3, "No"), "No, I do not require sponsorship");
check("radio   sponsorship Yes", radioLabel(r3, "Yes"), "Yes, I will require sponsorship");

// 11. Ambiguous group -> blank.
const r4 = makeRadioGroup("Are you authorized to work?", ["I am not authorized to work in the US"], "ambq");
check("radio   Yes with only a negative option -> blank", radioLabel(r4, "Yes"), "(blank)");

// 12. Non-boolean answers never drive radios.
check("radio   non-boolean value -> blank", radioLabel(r1, "Male"), "(blank)");

// --- react-select options -------------------------------------------------
function makeOptions(texts) {
  return texts.map((text) => {
    const el = document.createElement("div");
    el.className = "select__option";
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  });
}
function comboSel(texts, value) {
  const picked = JA.matchOptionElement(makeOptions(texts), value);
  return picked ? picked.textContent : "(blank)";
}
check(
  "combo   Yes skips 'not authorized' (bad order)",
  comboSel(["I am not authorized to work in the US", "I am authorized to work in the US"], "Yes"),
  "I am authorized to work in the US"
);
check(
  "combo   No picks 'not authorized'",
  comboSel(["I am authorized to work in the US", "I am not authorized to work in the US"], "No"),
  "I am not authorized to work in the US"
);
check(
  "combo   decline option",
  comboSel(["Yes", "No", "I prefer not to answer"], "Prefer not to say"),
  "I prefer not to answer"
);
check(
  "combo   mismatched polarity -> blank",
  comboSel(["I am not authorized to work in the US"], "Yes"),
  "(blank)"
);

console.log(
  `\n${fail === 0 ? "POLARITY E2E PASS" : "POLARITY E2E FAIL"} (${pass} passed, ${fail} failed)`
);
process.exit(fail === 0 ? 0 : 1);

