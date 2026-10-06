// End-to-end test for the ANSWER BANK (multiline snippets) + UNFILLED report.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP, "test-form.html"), "utf8");

function runWith(profile, done) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });
  let report = null;
  window.chrome = {
    storage: { local: { get: async () => ({ jobProfile: profile }) } },
    runtime: { sendMessage: (m) => { report = m; } }
  };
  window.eval(SOURCE);
  (async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]); done(window, report); })();
}

const PARAGRAPH =
  "At my last internship I migrated a monolithic deploy pipeline to containers, " +
  "cutting release time from days to minutes while keeping zero downtime.";

// --- Case 1: no answer-bank entry -> both free-text fields land in unfilled.
runWith({ firstName: "Jane" }, (window, report1) => {
  const why = window.document.getElementById("why_here").value;
  const hardest = window.document.getElementById("hardest").value;
  // Unfilled entries are now objects ({ label, required, ref }); read the labels.
  const unfilled = ((report1 && report1.unfilled) || []).map((e) =>
    typeof e === "string" ? e : e.label || ""
  );
  const mentionsHardest = unfilled.some((l) => /hardest/i.test(l));
  const mentionsWhy = unfilled.some((l) => /why do you want/i.test(l));

  console.log("--- CASE 1: no answer bank ---");
  console.log("why_here empty        :", why === "" ? "PASS" : "FAIL");
  console.log("hardest listed        :", mentionsHardest ? "PASS" : "FAIL");
  console.log("why-here listed       :", mentionsWhy ? "PASS" : "FAIL");
  console.log("unfilled              :", JSON.stringify(unfilled));

  // --- Case 2: add an answer-bank entry keyed on the question text.
  runWith(
    {
      firstName: "Jane",
      customSnippets: [{ key: "why do you want to work", value: PARAGRAPH }]
    },
    (window2, report2) => {
      const why2 = window2.document.getElementById("why_here").value;
      const hardest2 = window2.document.getElementById("hardest").value;
      const unfilled2 = ((report2 && report2.unfilled) || []).map((e) =>
        typeof e === "string" ? e : e.label || ""
      );
      const stillHardest = unfilled2.some((l) => /hardest/i.test(l));
      const whyGone = !unfilled2.some((l) => /why do you want/i.test(l));

      console.log("\n--- CASE 2: with answer bank ---");
      console.log("why_here filled       :", why2 === PARAGRAPH ? "PASS" : "FAIL");
      console.log("multiline preserved   :", why2.includes("containers") ? "PASS" : "FAIL");
      console.log("hardest still empty   :", hardest2 === "" ? "PASS" : "FAIL");
      console.log("hardest still listed  :", stillHardest ? "PASS" : "FAIL");
      console.log("why-here no longer    :", whyGone ? "PASS" : "FAIL (should be filled now)");
      console.log("unfilled              :", JSON.stringify(unfilled2));

      const ok =
        why === "" && mentionsHardest && mentionsWhy &&
        why2 === PARAGRAPH && hardest2 === "" && stillHardest && whyGone;
      console.log("\n" + (ok ? "ANSWER-BANK E2E PASS" : "ANSWER-BANK E2E FAIL"));
      process.exit(ok ? 0 : 1);
    }
  );
});