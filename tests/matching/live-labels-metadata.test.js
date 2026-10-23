"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
async function fixture(body, url) {
 const dom = new JSDOM(`<!doctype html>${body}`, { url, runScripts: "outside-only", pretendToBeVisual: true });
 const w = dom.window;
 w.Element.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
 w.chrome = { storage: { local: { get: async () => ({}) } }, runtime: { sendMessage() {} } };
 w.eval(CONTENT_SRC);
 await w.__jobAutofillRun;
 return w;
}
(async () => {
 const lever = await fixture(`<title>Palantir Technologies - Engineer</title><body>
 <img alt="Palantir Technologies logo"><h1>Palantir Technologies</h1><div class="posting-header"><h2>Engineer</h2></div>
 <div class="application-question"><div><div class="application-label">Why this role? *</div><textarea name="cards[uuid][field1]"></textarea></div></div>
 <div class="application-question"><div class="application-label">Do you need sponsorship? *</div><label><input type="radio" name="cards[uuid][field2]">Yes</label><label><input type="radio" name="cards[uuid][field2]">No</label></div>
 <input name="technical[1234]">
 </body>`, "https://jobs.lever.co/palantir/id/apply");
 const ja = lever.__JobAutofill;
 assert.strictEqual(ja.pageInfo().role, "Engineer");
 const entries = ja.report.collectUnfilled(new Set());
 assert(entries.some(e => e.label === "Why this role?" && e.required));
 assert(entries.some(e => e.label === "Do you need sponsorship?" && e.required));
 assert(!entries.some(e => /cards|uuid|technical\[/.test(e.label)));
 lever.close();
 const leverNoLogo = await fixture('<title>Palantir Technologies - Engineer - Warp Speed</title><body></body>', 'https://jobs.lever.co/palantir/id/apply');
 assert.strictEqual(leverNoLogo.__JobAutofill.pageInfo().company, 'Palantir Technologies');
 assert.strictEqual(leverNoLogo.__JobAutofill.pageInfo().role, 'Engineer - Warp Speed');
 leverNoLogo.close();
 const oracle = await fixture('<title>Software Engineer - Akamai Careers</title><body><h1 hidden>Work Summary</h1><h2 class="job-details__title">Software Engineer</h2></body>', 'https://jobs.akamai.com/en/sites/CX_1/job/1');
 assert.strictEqual(oracle.__JobAutofill.pageInfo().role, "Software Engineer");
 oracle.close();
 const workday = await fixture('<title>Careers</title><body><a href="https://www.rtx.com/privacy">Job Applicant Privacy Notice</a></body>', 'https://globalhr.wd5.myworkdayjobs.com/REC_RTX_Ext_Gateway/job/1');
 assert.strictEqual(workday.__JobAutofill.pageInfo().company, "RTX");
 workday.close();
 console.log("Human question labels and visible employer/role metadata PASS");
})().catch(e => { console.error(e); process.exitCode = 1; });
