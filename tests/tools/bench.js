// bench.js — how long does ONE fill pass take, and how much DOM work does it do?
//
// Not a correctness suite. It loads the REAL content scripts (from the injected list in shared/index.js)
// against a synthetic form and reports:
//   * wall time to complete the run (window.__jobAutofillRun)
//   * how many document.querySelectorAll() calls the pass made
//   * the scanned field count
//
// jsdom is far slower than Chrome at querySelectorAll, so treat the ms as a
// SHAPE, not the shipping number. The selector-call count is engine-independent
// and is the honest measure of algorithmic cost.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const { APP_DIR, CONTENT_SCRIPTS } = require("../_popup-source");
const SOURCE = CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

// --- Build a form with `decoys` extra fields -------------------------------
const decoys = Number(process.argv[2] || 400);
const real = [
  ["First Name", "first_name", "text"],
  ["Last Name", "last_name", "text"],
  ["Email", "email", "email"],
  ["Phone", "phone", "tel"],
  ["LinkedIn URL", "linkedin", "url"],
  ["GitHub URL", "github", "url"],
  ["Portfolio", "portfolio", "url"],
  ["Street Address", "address", "text"],
  ["City", "city", "text"],
  ["State", "state", "text"],
  ["Zip", "zip", "text"],
  ["Country", "country", "text"]
];
let html = "<!doctype html><html><body><form>";
for (let i = 0; i < decoys; i++) {
  html += `<label for="d${i}">Question number ${i}</label>` +
    `<input id="d${i}" name="d${i}" type="text" />`;
}
for (const [label, name, type] of real) {
  html += `<label for="${name}">${label}</label>` +
    `<input id="${name}" name="${name}" type="${type}" />`;
}
html += "</form></body></html>";

const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

// Count querySelectorAll calls, engine-independent.
let selectorCalls = 0;
const realQSA = window.document.querySelectorAll.bind(window.document);
window.document.querySelectorAll = (...args) => { selectorCalls++; return realQSA(...args); };

window.chrome = {
  storage: { local: { get: async () => ({ jobProfile: {
    firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "+1 555 123 4567",
    linkedin: "https://example.com/linkedin-profile", github: "https://example.com/github-profile",
    portfolio: "https://portfolio.example.com", address: "1 Main St", city: "Austin",
    state: "TX", zip: "78701", country: "United States"
  } }) } },
  runtime: { sendMessage: () => {} }
};

window.eval(SOURCE);

(async () => {
  const t0 = performance.now();
  selectorCalls = 0;
  // Never hang: whatever the run does, stop waiting after 8s.
  await Promise.race([
    Promise.resolve(window.__jobAutofillRun).catch(() => {}),
    new Promise((r) => setTimeout(r, 8000))
  ]);
  const ms = performance.now() - t0;

  const scanned = window.document.querySelectorAll("input, select, textarea").length;
  console.log(`fields in DOM        : ${scanned}`);
  console.log(`filled               : ${window.document.getElementById("first_name").value ? "yes" : "no"} (first_name="${window.document.getElementById("first_name").value}")`);
  console.log(`querySelectorAll calls: ${selectorCalls}`);
  console.log(`wall time (jsdom)    : ${ms.toFixed(1)} ms`);
  process.exit(0);
})();
