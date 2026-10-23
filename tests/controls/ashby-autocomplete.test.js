"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const dom = new JSDOM(`<!doctype html><body>
 <div><label class="_required_test" for="school">School</label><div>
 <input id="school" role="combobox" class="ashby-application-form-input-autocomplete" aria-expanded="false" aria-controls="school-menu"></div></div>
 <div id="school-menu" hidden><div role="option"><div><span class="_canonicalSchoolResultName_test">Stanford University</span><span>United States</span></div><span>stanford.edu</span></div></div>
 <div role="listbox" hidden><div role="option">Afghanistan +93</div></div>
 <fieldset id="degree"><legend>Degree</legend><label><input type="radio" name="degree" value="bachelors">Bachelor's Degree</label><label><input type="radio" name="degree" value="masters">Master's Degree</label></fieldset>
`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.Element.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{}]; };
w.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage() {} } };
w.eval(CONTENT_SRC);
(async () => {
 await w.__jobAutofillRun;
 const j = w.__JobAutofill, input = d.getElementById("school"), menu = d.getElementById("school-menu");
 input.addEventListener("input", () => { menu.hidden = !input.value; input.setAttribute("aria-expanded", String(!menu.hidden)); });
 menu.firstElementChild.addEventListener("click", () => { input.value = "Stanford University"; input.setAttribute("aria-expanded", "false"); menu.hidden = true; });
 const control = j.comboControls()[0];
 assert(j.comboRequired(control));
 assert(await j.chooseComboControl(control, "Stanford University", new Set()));
 assert.strictEqual(input.value, "Stanford University");
 assert.strictEqual(j.comboValueEl(control), input);
 assert(!j.report.collectUnfilled(new Set()).some(e => e.label === "School"));
 input.value = "Unfinished query";
 assert.strictEqual(j.comboValueEl(control), null);
 assert.strictEqual(j.comboControlForKeywords(["school"], new Set()), null);
 assert(j.report.collectUnfilled(new Set()).some(e => e.label === "School" && e.required));
 assert(await j.fillFieldByKeywords(d.getElementById("degree"), ["degree"], "Bachelor's Degree"));
 assert(d.querySelector('input[value="bachelors"]').checked);
 console.log("Ashby school option names, committed selections and unfinished queries PASS");
 w.close();
})().catch(e => { console.error(e); process.exitCode = 1; w.close(); });
