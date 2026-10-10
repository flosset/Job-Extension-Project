// End-to-end test for REPEATABLE SECTIONS (Workday "Work Experience"):
//   reuses existing auto-parsed blocks (overwriting their junk), clicks
//   "Add Another" when the profile has more entries, and deletes the surplus
//   blocks so the count matches exactly.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR: APP } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP, "test-workday.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

const ENTRIES = [
  {
    title: "Software Developer Intern",
    company: "Broadcom",
    location: "Lisle, IL",
    from: "May 2026",
    to: "August 2026",
    description: "Refactored 1,000+ legacy security tests into standalone JCL test streams.",
    current: false
  },
  {
    title: "Software Engineer Intern",
    company: "IBM",
    location: "Austin, TX",
    from: "05/2025",
    to: "08/2025",
    description: "Built a service that cut pipeline runtime by 25%.",
    current: false
  },
  {
    title: "Research Assistant",
    company: "State University",
    location: "Austin, TX",
    from: "2024-09",
    to: "",
    description: "Ongoing research in distributed systems.",
    current: true
  }
];

window.chrome = {
  storage: { local: { get: async () => ({ jobProfile: { workExperiences: ENTRIES, replaceHistory: true } }) } },
  runtime: { sendMessage: () => {} }
};

window.__jobAutofillDeleteApproval = true;
window.eval(SOURCE);

function readBlock(i) {
  const block = document.querySelectorAll(".exp-block")[i];
  if (!block) return null;
  return {
    title: block.querySelector('input[id^="jt"]').value,
    company: block.querySelector('input[id^="co"]').value,
    location: block.querySelector('input[id^="lo"]').value,
    from: block.querySelector('input[id^="fr"]').value,
    to: block.querySelector('input[id^="to"]').value,
    description: block.querySelector("textarea").value,
    current: block.querySelector('input[type="checkbox"]').checked
  };
}

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const count = document.querySelectorAll(".exp-block").length;
  const b0 = readBlock(0);
  const b1 = readBlock(1);
  const b2 = readBlock(2);

  console.log("\n--- RESULT ---");
  const checks = [
    ["block count (4 junk \u2192 3, trim opted in)", String(count), "3"],
    ["block1 title  ", b0.title, ENTRIES[0].title],
    ["block1 company", b0.company, ENTRIES[0].company],
    ["block1 from (May 2026 → MM/YYYY)", b0.from, "05/2026"],
    ["block1 to   (August 2026 → MM/YYYY)", b0.to, "08/2026"],
    ["block1 desc overwritten", b0.description, ENTRIES[0].description],
    ["block2 title  ", b1.title, ENTRIES[1].title],
    ["block2 company", b1.company, ENTRIES[1].company],
    ["block2 from   ", b1.from, "05/2025"],
    ["block3 title (added)", b2.title, ENTRIES[2].title],
    ["block3 company (added)", b2.company, ENTRIES[2].company],
    ["block3 from (2024-09 → MM/YYYY)", b2.from, "09/2024"],
    ["block3 'current' ticked", String(b2.current), "true"]
  ];
  let ok = true;
  const safeDom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  safeDom.window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  safeDom.window.chrome = window.chrome;
  safeDom.window.eval(SOURCE);
  await safeDom.window.__jobAutofillRun;
  const safeCount = safeDom.window.document.querySelectorAll(".exp-block").length;
  const safe = safeCount === 4;
  ok = ok && safe;
  console.log(`Persisted replaceHistory without per-run approval: ${safe ? "PASS" : "FAIL"}`);
  safeDom.window.close();
  for (const [name, got, want] of checks) {
    const pass = got === want;
    ok = ok && pass;
    console.log(`${name}: ${JSON.stringify(got)} ${pass ? "PASS" : "FAIL (want " + JSON.stringify(want) + ")"}`);
  }
  console.log("\n" + (ok ? "REPEATABLE E2E PASS" : "REPEATABLE E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
