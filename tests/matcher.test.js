// matcher.test.js — self-identification option matcher, run against the REAL
// source files.
//
// This test used to duplicate normalize/expandValueTokens/findOptionForValue in
// a local copy "mirroring autofill.js". That copy silently drifted out of date
// (it still listed the veteran sub-category synonyms removed in v1.11.0), so it
// validated nothing. It now loads the shipped files like the e2e suites do.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = path.resolve(__dirname, "..");
// The whole injected pipeline (every content script, in the shipped order) —
// nothing here may test a hand-picked subset that a reorganization could leave
// pointing at files the extension no longer has.
const SOURCE = require("./_popup-source").CONTENT_SRC;

const vc = new VirtualConsole();
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;
const document = window.document;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.chrome = {
  storage: { local: { get: async () => ({}) } },
  runtime: { sendMessage: () => {} }
};
window.eval(SOURCE);
const JA = window.__JobAutofill;

/** Build a real <select> from option labels ("text" or ["text", "value"]). */
function makeSelect(labels) {
  const sel = document.createElement("select");
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select...";
  sel.appendChild(ph);
  labels.forEach((label) => {
    const option = document.createElement("option");
    if (Array.isArray(label)) {
      option.textContent = label[0];
      option.value = label[1];
    } else {
      option.textContent = label;
      option.value = label;
    }
    sel.appendChild(option);
  });
  document.body.appendChild(sel);
  return sel;
}

/** Run the shipped matcher against a fresh <select>; return the chosen text. */
function pick(labels, value) {
  const option = JA.findOptionForValue(makeSelect(labels), value);
  return option ? option.textContent : "(none)";
}

let pass = 0;
let fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(
    (ok ? "PASS" : "FAIL") + "  " + name + " -> " + got +
      (ok ? "" : "  [expected " + expected + "]")
  );
}

check("Male -> Man", pick(["Man", "Woman", "Non-binary", "Decline to self-identify"], "Male"), "Man");
check("Male -> Male", pick(["Female", "Male", ""], "Male"), "Male");
check("Female -> Woman", pick(["Man", "Woman"], "Female"), "Woman");
check("Female not Male", pick(["Male", "Female"], "Female"), "Female");
check("White (long)", pick(["White (Not Hispanic or Latino)", "Black or African American"], "White"), "White (Not Hispanic or Latino)");
check("prefer-not-to-say -> decline", pick(["Decline to self-identify", "Male", "Female"], "Prefer not to say"), "Decline to self-identify");
check("Male has no match", pick(["Female", "Other"], "Male"), "(none)");

// Veteran: the sub-categories are NOT the protected-veteran answer, and a
// sub-category-only list must be left blank (regression guard for v1.11.0).
check(
  "protected veteran exact",
  pick(["I am a protected veteran", "I am not a protected veteran", "I prefer not to answer"], "I am a protected veteran"),
  "I am a protected veteran"
);
check(
  "NOT protected veteran",
  pick(["I am a protected veteran", "I am not a protected veteran", "I prefer not to answer"], "I am not a protected veteran"),
  "I am not a protected veteran"
);
check(
  "sub-categories only -> blank",
  pick(["Disabled veteran", "Active duty wartime or campaign badge veteran"], "I am a protected veteran"),
  "(none)"
);

check("disability No", pick(["Yes", "No", "I don't wish to answer"], "No, I do not have a disability"), "No");
check("disability Yes", pick(["Yes", "No", "I don't wish to answer"], "Yes, I have a disability"), "Yes");

// State abbreviation <-> full name.
check("TX -> Texas", pick(["Texas", "California"], "TX"), "Texas");
check("Texas -> TX", pick([["Texas", "TX"], "California"], "Texas"), "Texas");

console.log("\n" + (fail === 0 ? "ALL OPTION TESTS PASS" : fail + " TEST(S) FAILED") + " (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
