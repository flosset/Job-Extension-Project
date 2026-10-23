"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const dom = new JSDOM(`<!doctype html><body>
 <label for="firstName">First Name *</label><input id="firstName" required>
 <div><label>Are you legally authorized to work?</label><div class="input-yesno">
 <button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div></div>
`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.Element.prototype.getClientRects = () => [{}];
let result;
w.chrome = { storage: { local: { get: async () => ({ jobProfile: { firstName: "Casey", workAuthorization: "Yes" } }) } }, runtime: { sendMessage: r => { result = r; } } };
w.document.getElementById("firstName").addEventListener("input", e => { setTimeout(() => { e.target.value = ""; }, 10); });
w.eval(CONTENT_SRC);
(async () => {
 await w.__jobAutofillRun;
 assert.strictEqual(result.filled, 0);
 assert(result.unfilled.some(e => e.label === "First Name" && e.required));
 const pair = w.__JobAutofill.yesNoPairs()[0];
 w.__JobAutofill.chooseYesNo(pair.buttons, "Yes");
 assert.strictEqual(w.__JobAutofill.yesNoAnswer(pair), "");
 assert(pair.buttons.every(b => b.getAttribute("aria-pressed") === "false"));
 const original = w.document.getElementById("firstName");
 const replacement = original.cloneNode();
 replacement.value = "Casey";
 original.replaceWith(replacement);
 assert.strictEqual(w.__JobAutofill.currentField(original), replacement);
 assert(w.__JobAutofill.valueCommitted(original, "Casey"));
 const frame = w.document.createElement("iframe");
 w.document.body.appendChild(frame);
 const child = frame.contentWindow;
 child.Element.prototype.getClientRects = () => [];
 let childResult;
 child.chrome = { storage: { local: { get: async () => ({ jobProfile: { educations: [{ school: "Example University" }] } }) } }, runtime: { sendMessage: r => { childResult = r; } } };
 child.eval(CONTENT_SRC);
 await child.__jobAutofillRun;
 assert.strictEqual(childResult.sectionIssues.length, 0);
 console.log("Rejected writes and uncommitted button clicks are not successful fills PASS");
 w.close();
})().catch(e => { console.error(e); process.exitCode = 1; w.close(); });
