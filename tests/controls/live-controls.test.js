"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const dom = new JSDOM(`<!doctype html><body>
  <label for="source">How Did You Hear About Us? *</label>
  <button id="source" aria-haspopup="listbox" aria-controls="source-menu">Select One</button>
  <div id="source-menu" role="listbox" hidden><div role="option">Referral</div></div>
  <div role="listbox" hidden><div role="option">Afghanistan +93</div></div>
  <label for="school">School *</label><div><input id="school" role="combobox" aria-controls="schools"></div>
  <div id="schools" role="listbox" hidden><div role="option">Example University</div></div>
  <label for="email">Email</label><input id="email" type="email">
`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.Element.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{}]; };
w.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage() {} } };
w.eval(CONTENT_SRC);
const JA = w.__JobAutofill;
(async () => {
  await w.__jobAutofillRun;
  const source = d.getElementById("source"), school = d.getElementById("school");
  const entries = JA.report.collectUnfilled(new Set([source, school]));
  assert(entries.some(e => e.required && /Hear About/.test(e.label)));
  assert(entries.some(e => e.required && e.label === "School"));
  assert.strictEqual(JA.matcher.pickField("school", JA.fieldPool(), new Set()), null);
  assert.strictEqual(JA.optionsForControl(source).length, 0);
  d.getElementById("source-menu").hidden = false;
  assert.deepStrictEqual(JA.optionsForControl(source).map(e => e.textContent).join(), "Referral");
  assert.strictEqual((await JA.waitForOptions(1, source))[0].textContent, "Referral");
  source.textContent = "Referral";
  assert.strictEqual(JA.comboValueEl(source), source);
  assert(!JA.report.collectUnfilled(new Set()).some(e => /Hear About/.test(e.label)));
  const email = d.getElementById("email");
  JA.assignValue(email, "casey.qa@example.com");
  assert(JA.valueCommitted(email, "casey.qa@example.com"));
  email.value = "";
  assert(!JA.valueCommitted(email, "casey.qa@example.com"));
  email.value = "invalid";
  assert(!JA.valueCommitted(email, "invalid"));
  assert(JA.report.collectUnfilled(new Set()).some(e => e.label === "Email"));
  source.setAttribute("aria-invalid", "true");
  assert(!(await JA.comboCommitted(source, 0, "Referral")));
  assert(JA.report.collectUnfilled(new Set()).some(e => /Hear About/.test(e.label)));
  for (let i = 0; i < 42; i++) d.body.insertAdjacentHTML("beforeend", `<input aria-label="Optional ${i}">`);
  source.textContent = "Select One";
  const capped = JA.report.collectUnfilled(new Set());
  assert.strictEqual(capped.length, 40);
  assert(capped.some(e => e.required && /Hear About/.test(e.label)));
  assert(capped[0].required);
  console.log("Live control reporting, option ownership and commitment PASS");
  w.close();
})().catch(e => { console.error(e); process.exitCode = 1; w.close(); });
