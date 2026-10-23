"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const question = "How did you first learn about Affirm as an employer?";
const combo = (id, label) => `<label for="${id}">${label}</label>
  <div class="select__control"><input id="${id}" role="combobox" aria-required="true" aria-expanded="false"></div>`;
async function fixture(bank = []) {
  const store = { jobProfile: { customSnippets: bank } };
  const dom = new JSDOM(`<body>${combo("hear", question)}${combo("gender", "Gender")}</body>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "https://jobs.example.com/apply" });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  w.chrome = { storage: { local: {
    get: async () => store,
    set: async data => Object.assign(store, data)
  }, onChanged: { addListener: () => {} } },
  runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } } };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun;
  const J = w.__JobAutofill;
  const input = w.document.getElementById("hear");
  return { w, J, input, store, dom };
}
function select(w, input, text) {
  input.value = "";
  let value = input.parentElement.querySelector(".select__single-value");
  if (!value) {
    value = w.document.createElement("div");
    value.className = "select__single-value";
    input.parentElement.append(value);
  }
  value.textContent = text;
  input.setAttribute("aria-expanded", "false");
}
(async () => {
  const p = await fixture();
  const missing = p.J.report.collectUnfilled(new Set());
  const entry = missing.find(e => e.label === question);
  assert(entry && entry.required && entry.ref, "unanswered custom dropdown is required and tracked");
  p.input.value = "Link";
  p.input.setAttribute("aria-expanded", "true");
  p.input.dispatchEvent(new p.w.Event("change", { bubbles: true }));
  p.input.dispatchEvent(new p.w.Event("blur", { bubbles: true }));
  await sleep(600);
  assert(!p.store.learnedAnswers?.candidates.length, "search text is never learned");
  select(p.w, p.input, "LinkedIn");
  select(p.w, p.w.document.getElementById("gender"), "Woman");
  const deadline = Date.now() + 10000;
  while (!p.store.learnedAnswers?.candidates.length && Date.now() < deadline) await sleep(25);
  assert(p.store.learnedAnswers?.candidates.length, "the committed answer reaches storage");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.store.learnedAnswers.candidates.map(c => [c.question, c.value]))),
    [[question, "LinkedIn"]], "only the committed, non-demographic answer is offered");
  assert(!p.J.report.collectUnfilled(new Set()).some(e => e.label === question), "answered dropdown disappears from missing list");
  assert.equal(p.store.jobProfile.customSnippets.length, 0, "candidate is not automatically saved");
  p.dom.window.close();

  const covered = await fixture([{ key: question, value: "LinkedIn" }]);
  select(covered.w, covered.input, "Glassdoor");
  await sleep(650);
  assert(!covered.store.learnedAnswers?.candidates.length, "bank-covered question is not offered again");
  covered.dom.window.close();

  const auto = await fixture();
  auto.w.__jobAutofillActive = true;
  select(auto.w, auto.input, "LinkedIn");
  await sleep(20);
  auto.w.__jobAutofillActive = false;
  auto.input.setAttribute("aria-expanded", "true");
  await sleep(20);
  auto.input.setAttribute("aria-expanded", "false");
  auto.w.document.body.append(auto.w.document.createElement("p"));
  await sleep(650);
  assert(!auto.store.learnedAnswers?.candidates.length, "autofill and unrelated mutations do not teach themselves");
  auto.dom.window.close();
  console.log("COMBOBOX LEARNING PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
