// Standalone sanity test for the self-identification option matcher.
// Mirrors normalize/expandValueTokens/findOptionForValue from autofill.js.
"use strict";

function normalize(text) {
  return (text || "").toLowerCase().replace(/[_\-\.]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function escapeRegExp(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const VALUE_SYNONYMS = {
  male: ["man"], female: ["woman"],
  "non binary": ["nonbinary", "genderqueer", "gender diverse", "gender variant"],
  "american indian or alaska native": ["american indian", "alaska native", "native american"],
  asian: ["asian"], "black or african american": ["black", "african american"],
  "hispanic or latino": ["hispanic", "latino", "latina", "latinx"],
  "native hawaiian or other pacific islander": ["native hawaiian", "pacific islander"],
  white: ["caucasian"], "two or more races": ["two or more", "multiracial", "mixed", "more than one race"],
  "i am a protected veteran": ["am a protected veteran", "active duty", "currently serve", "reserve", "national guard"],
  "i am not a protected veteran": ["am not a protected veteran", "not protected"],
  "yes i have a disability": ["yes", "have a disability"],
  "no i do not have a disability": ["no", "do not have a disability", "don t have a disability"],
  "prefer not to say": ["prefer not", "decline", "do not wish", "don t wish", "not to disclose", "do not want", "no answer", "choose not", "wish to answer"]
};

function expandValueTokens(value) {
  const primary = normalize(value);
  return [primary].concat((VALUE_SYNONYMS[primary] || []).filter(Boolean));
}

function findOptionForValue(options, value) {
  const tokens = expandValueTokens(value);
  const opts = options.filter((o) => (o.value || "").trim() !== "");
  for (const token of tokens) {
    for (const o of opts) {
      if (normalize(o.text) === token || normalize(o.value) === token) return o;
    }
  }
  for (const token of tokens) {
    const re = new RegExp("(^| )" + escapeRegExp(token) + "( |$)");
    for (const o of opts) {
      if (re.test(normalize(o.text)) || re.test(normalize(o.value))) return o;
    }
  }
  return null;
}

const opt = (text, value = text) => ({ text, value });
let pass = 0, fail = 0;
function check(name, got, expected) {
  const actual = got ? got.text : "(none)";
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + " -> " + actual + (ok ? "" : "  [expected " + expected + "]"));
}

check("Male -> Man", findOptionForValue([opt("Man"), opt("Woman"), opt("Non-binary"), opt("Decline to self-identify")], "Male"), "Man");
check("Male -> Male", findOptionForValue([opt("Female"), opt("Male"), opt("")], "Male"), "Male");
check("Female -> Woman", findOptionForValue([opt("Man"), opt("Woman")], "Female"), "Woman");
check("Female not Male", findOptionForValue([opt("Male"), opt("Female")], "Female"), "Female");
check("protected veteran exact", findOptionForValue([opt("I am a protected veteran"), opt("I am not a protected veteran"), opt("I prefer not to answer")], "I am a protected veteran"), "I am a protected veteran");
check("NOT protected veteran", findOptionForValue([opt("I am a protected veteran"), opt("I am not a protected veteran"), opt("I prefer not to answer")], "I am not a protected veteran"), "I am not a protected veteran");
check("disability No", findOptionForValue([opt("Yes"), opt("No"), opt("I don't wish to answer")], "No, I do not have a disability"), "No");
check("disability Yes", findOptionForValue([opt("Yes"), opt("No"), opt("I don't wish to answer")], "Yes, I have a disability"), "Yes");
check("White (long)", findOptionForValue([opt("White (Not Hispanic or Latino)"), opt("Black or African American")], "White"), "White (Not Hispanic or Latino)");
check("prefer-not-to-say -> decline", findOptionForValue([opt("Decline to self-identify"), opt("Male"), opt("Female")], "Prefer not to say"), "Decline to self-identify");
check("Male has no match", findOptionForValue([opt("Female"), opt("Other")], "Male"), "(none)");

console.log("\n" + (fail === 0 ? "ALL OPTION TESTS PASS" : fail + " TEST(S) FAILED") + " (" + pass + " passed)");
process.exit(fail === 0 ? 0 : 1);
