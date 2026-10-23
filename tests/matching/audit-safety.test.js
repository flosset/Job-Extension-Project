"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, CONTENT_SCRIPTS } = require("../_popup-source");
const source = CONTENT_SCRIPTS.filter(file => file !== "content/autofill.js")
  .map(file => fs.readFileSync(path.join(APP_DIR, file), "utf8")).join("\n");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const w = new JSDOM(`<!doctype html><body>
  <input type="email" id="hiddenEmail" style="visibility:hidden"><input type="email" id="email">
  <section id="education"><label for="school">School</label><input id="school">
    <label for="degree">Degree</label><input id="degree"></section>
  <section><button type="button" id="wrong">Add Another</button></section>
  <button type="button" id="right">Add Education</button>
  <select id="language"><option value="cpp">C++</option><option value="cs">C#</option></select>
  <select id="country"><option value="cn">中国</option><option value="jp">日本</option></select>
  <label for="salary">Expected salary</label><input id="salary">
  <input type="file" required id="resume">
</body>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://jobs.example.com/form" }).window;
const store = { jobProfile: {} };
w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
w.chrome = { storage: { local: {
  get: async () => structuredClone(store), set: async values => Object.assign(store, structuredClone(values))
} } };
w.eval(source);
const JA = w.__JobAutofill;
(async () => {
  assert.strictEqual(JA.matcher.pickField("email", JA.fieldPool(), new Set()).id, "email");
  assert.strictEqual(JA.isVisible(w.document.getElementById("hiddenEmail")), false);
  assert.strictEqual(JA.findOptionForValue(w.document.getElementById("language"), "C#").value, "cs");
  assert.strictEqual(JA.findOptionForValue(w.document.getElementById("country"), "日本").value, "jp");
  assert.strictEqual(JA.findOptionForValue(w.document.getElementById("country"), "???"), null);
  assert.strictEqual(JA.matchOptionElement([...w.document.getElementById("language").options], "C#").value, "cs");
  let clicked = "";
  for (const id of ["wrong", "right"]) w.document.getElementById(id).addEventListener("click", () => { clicked = id; });
  assert(JA.clickSectionAdd(JA.SECTIONS.education));
  assert.strictEqual(clicked, "right", "education cannot click an unrelated generic add button");
  w.document.getElementById("right").remove(); clicked = "";
  assert.strictEqual(JA.clickSectionAdd(JA.SECTIONS.education), false, "ambiguous ownership is skipped");
  assert.strictEqual(clicked, "");
  JA.armLearning([{ label: "Expected salary" }]);
  await sleep(0);
  const salary = w.document.getElementById("salary");
  salary.value = "100"; salary.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(600);
  assert.strictEqual(store.learnedAnswers.candidates.length, 1);
  salary.value = "200"; salary.dispatchEvent(new w.Event("change", { bubbles: true }));
  await sleep(600);
  assert.strictEqual(store.learnedAnswers.candidates.length, 0, "ambiguity removes an already persisted suggestion");
  assert(store.learnedAnswers.skipped.includes("Expected salary"));
  assert.strictEqual(w.document.getElementById("resume").files.length, 0);
  console.log("AUDIT MATCHING SAFETY PASS");
})().finally(() => w.close()).catch(error => { console.error(error); process.exitCode = 1; });
