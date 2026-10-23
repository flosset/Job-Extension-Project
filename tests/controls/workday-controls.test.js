"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const dom = new JSDOM(`<!doctype html><body>
 <div id="work"><fieldset><legend><label>From *</label></legend><div id="from" data-automation-id="dateInputWrapper">
 <input role="spinbutton" aria-label="Month" id="from-dateSectionMonth-input">
 <input role="spinbutton" aria-label="Year" id="from-dateSectionYear-input"></div></fieldset></div>
 <div><div><div><label for="phoneNumber--countryPhoneCode">Country Phone Code</label><div data-automation-id="multiselectInputContainer"><div><input id="phoneNumber--countryPhoneCode" data-uxi-widget-type="selectinput"></div><ul role="listbox" data-automation-id="selectedItemList"><li><span role="option" data-automation-id="selectedItem">United States (+1)</span></li></ul></div></div></div><label for="phoneNumber--phoneNumber">Phone Number</label><input id="phoneNumber--phoneNumber" type="tel"></div>
 <div id="degree"><fieldset><legend><div>Degree *</div></legend><button id="degree-button" aria-label="Select One Required" aria-haspopup="listbox" aria-controls="degrees">Select One</button>
 <div role="listbox" id="degrees" hidden><div role="option">Bachelors</div></div></fieldset></div>
`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.Element.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{}]; };
w.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage() {} } };
w.eval(CONTENT_SRC);
const JA = w.__JobAutofill;
(async () => {
 await w.__jobAutofillRun;
 const button = d.getElementById("degree-button"), menu = d.getElementById("degrees");
 button.addEventListener("click", () => { menu.hidden = !menu.hidden; button.setAttribute("aria-expanded", String(!menu.hidden)); });
 menu.firstElementChild.addEventListener("click", () => { button.textContent = "Bachelors"; button.value = "opaque-backend-key"; menu.hidden = true; button.setAttribute("aria-expanded", "false"); });
 assert.strictEqual(JA.comboLabel(button), "Degree");
 assert(JA.report.collectUnfilled(new Set()).some(e => e.label === 'Degree' && e.required));
 assert(await JA.fillFieldByKeywords(d.getElementById("degree"), ["degree"], "Bachelor's Degree"));
 menu.hidden = false;
 button.setAttribute("aria-expanded", "true");
 await JA.closeCombo(button);
 assert(menu.hidden);
 const used = new Set();
 for (const input of d.querySelectorAll('[role="spinbutton"]')) {
   let digits = "";
   let dirty = false;
   input.addEventListener("focus", () => { dirty = false; });
   input.addEventListener("keydown", e => { if (/^\d$/.test(e.key)) digits += e.key; setTimeout(() => { dirty = true; }, 0); });
   input.addEventListener("blur", () => { input.value = dirty ? digits : ""; });
 }
 assert(await JA.fillFieldByKeywords(d.getElementById("work"), ["from"], "06/2022", { used }));
 assert.strictEqual(d.getElementById("from-dateSectionMonth-input").value, "06");
 assert.strictEqual(d.getElementById("from-dateSectionYear-input").value, "2022");
 assert.strictEqual(used.size, 2);
 const alert = d.createElement('p');
 alert.setAttribute('data-automation-id', 'inputAlert');
 alert.textContent = 'Invalid Date';
 d.querySelector('#work fieldset').appendChild(alert);
 assert(!JA.valueCommitted(d.getElementById('from-dateSectionYear-input'), '2022'));
 assert(JA.report.collectUnfilled(new Set()).some(e => e.required && e.label === 'From — Year'));
 alert.remove();
 const phone = JA.fillPhoneParts({ phone: "+12025550143" }, JA.fieldPool());
 assert(phone.recognised);
 assert.strictEqual(d.getElementById("phoneNumber--phoneNumber").value, "2025550143");
 assert.strictEqual(d.getElementById("phoneNumber--countryPhoneCode").value, "");
 assert(JA.isComboboxInput(d.getElementById("phoneNumber--countryPhoneCode")));
 const control = JA.comboControls().find(c => c.contains(d.getElementById("phoneNumber--countryPhoneCode")));
 assert.strictEqual(JA.comboValueEl(control).textContent, "United States (+1)");
 console.log("Workday button choices, segmented dates and selected phone codes PASS");
 w.close();
})().catch(e => { console.error(e); process.exitCode = 1; w.close(); });
