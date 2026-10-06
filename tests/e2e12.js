// End-to-end test for the EDUCATION repeatable section:
//   year-only dates, a Degree <select> (matched via synonyms), reuse+overwrite
//   of auto-parsed blocks, and its OWN "Add Another" button.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP, "test-workday.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

const EDUCATIONS = [
  { school: "State University", degree: "BS", major: "Computer Science", gpa: "3.9", from: "2022", to: "2026" },
  { school: "Community College", degree: "Associate", major: "General Studies", gpa: "3.5", from: "2020", to: "2022" },
  { school: "Online Academy", degree: "MS", major: "Data Science", gpa: "4.0", from: "2026", to: "2028" }
];

window.chrome = {
  storage: { local: { get: async () => ({ jobProfile: { educations: EDUCATIONS } }) } },
  runtime: { sendMessage: () => {} }
};

window.eval(SOURCE);

function readEdu(i) {
  const block = document.querySelectorAll(".edu-block")[i];
  if (!block) return null;
  const degreeSel = block.querySelector("select");
  return {
    school: block.querySelector('input[id^="sc"]').value,
    degree: degreeSel.options[degreeSel.selectedIndex].textContent,
    major: (function () {
      const val = block.querySelector(".select__single-value");
      return val ? val.textContent : "(empty)";
    })(),
    gpa: block.querySelector('input[id^="gp"]').value,
    from: block.querySelector('input[id^="yf"]').value,
    to: block.querySelector('input[id^="yt"]').value
  };
}

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const count = document.querySelectorAll(".edu-block").length;
  const e0 = readEdu(0);
  const e1 = readEdu(1);
  const e2 = readEdu(2);

  console.log("\n--- RESULT ---");
  const checks = [
    ["edu block count (2 junk → 3)", String(count), "3"],
    ["edu1 school (junk overwritten)", e0.school, "State University"],
    ["edu1 degree (BS → Bachelor's)", e0.degree, "Bachelor's Degree"],
    ["edu1 major ", e0.major, "Computer Science"],
    ["edu1 gpa   ", e0.gpa, "3.9"],
    ["edu1 from (YYYY)", e0.from, "2022"],
    ["edu1 to   (YYYY)", e0.to, "2026"],
    ["edu2 school", e1.school, "Community College"],
    ["edu2 degree (Associate)", e1.degree, "Associate Degree"],
    ["edu3 school (added)", e2.school, "Online Academy"],
    ["edu3 degree (MS → Master's)", e2.degree, "Master's Degree"],
    ["edu3 major (combobox, added)", e2.major, "Data Science"],
    ["edu2 major (combobox)", e1.major, "General Studies"]
  ];
  let ok = true;
  for (const [name, got, want] of checks) {
    const pass = got === want;
    ok = ok && pass;
    console.log(`${name}: ${JSON.stringify(got)} ${pass ? "PASS" : "FAIL (want " + JSON.stringify(want) + ")"}`);
  }
  console.log("\n" + (ok ? "EDUCATION E2E PASS" : "EDUCATION E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
