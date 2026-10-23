"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const dom = new JSDOM(`<!doctype html><body>
 <div id="work"><label for="from">From *</label><div id="from">
 <input role="spinbutton" aria-label="Month" id="from-dateSectionMonth-input">
 <input role="spinbutton" aria-label="Year" id="from-dateSectionYear-input"></div></div>
 <div><label for="phonecode">Country Phone Code</label><div><span data-automation-id="selectedItem">United States (+1)</span><input id="phonecode" role="combobox"></div><label for="phone">Phone Number</label><input id="phone" type="tel"></div>
 <div id="degree"><label for="degree-button">Degree *</label><button id="degree-button" aria-haspopup="listbox" aria-controls="degrees">Select One</button>
 <div role="listbox" id="degrees" hidden><div role="option">Bachelor's Degree</div></div></div>
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
 menu.firstElementChild.addEventListener("click", () => { button.textContent = "Bachelor's Degree"; menu.hidden = true; button.setAttribute("aria-expanded", "false"); });
 assert(await JA.fillFieldByKeywords(d.getElementById("degree"), ["degree"], "Bachelor's Degree"));
 menu.hidden = false;
 button.setAttribute("aria-expanded", "true");
 await JA.closeCombo(button);
 assert(menu.hidden);
 const used = new Set();
 for (const input of d.querySelectorAll('[role="spinbutton"]')) {
   let digits = "";
   input.addEventListener("keydown", e => { if (/^\d$/.test(e.key)) digits += e.key; });
   input.addEventListener("blur", () => { input.value = digits; });
 }
 assert(await JA.fillFieldByKeywords(d.getElementById("work"), ["from"], "06/2022", { used }));
 assert.strictEqual(d.getElementById("from-dateSectionMonth-input").value, "06");
 assert.strictEqual(d.getElementById("from-dateSectionYear-input").value, "2022");
 assert.strictEqual(used.size, 2);
 const phone = JA.fillPhoneParts({ phone: "+12025550143" }, JA.fieldPool());
 assert(phone.recognised);
 assert.strictEqual(d.getElementById("phone").value, "2025550143");
 assert.strictEqual(d.getElementById("phonecode").value, "");
 const control = JA.comboControls().find(c => c.contains(d.getElementById("phonecode")));
 assert.strictEqual(JA.comboValueEl(control).textContent, "United States (+1)");
 console.log("Workday button choices, segmented dates and selected phone codes PASS");
 w.close();
})().catch(e => { console.error(e); process.exitCode = 1; w.close(); });
