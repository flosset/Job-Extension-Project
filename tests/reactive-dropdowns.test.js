// End-to-end test for REACTIVE dropdown handling:
//   1. Answer-bank entries drive react-select dropdowns (only if the option
//      genuinely exists in the form's own list).
//   2. "Reveal options" reports the choices of required dropdowns we could not
//      answer â€” without ever auto-selecting anything.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = path.resolve(__dirname, "..");
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP, "test-form.html"), "utf8");

const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

let report = null;
window.chrome = {
  storage: {
    local: {
      get: async () => ({
        jobProfile: {
          firstName: "Jane",
          customSnippets: [
            { key: "preferred office location", value: "Seattle" },
            { key: "type of engineering", value: "Machine Learning" }
          ]
        }
      })
    }
  },
  runtime: { sendMessage: (m) => { report = m; } }
};

window.eval(SOURCE);

function comboValueFor(labelText) {
  // Find the control whose aria-labelledby element starts with the label text.
  const label = Array.from(document.querySelectorAll("label")).find((l) =>
    l.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())
  );
  if (!label) return "(no label)";
  const control = label.parentElement.querySelector(".select__control");
  if (!control) return "(no control)";
  const v = control.querySelector(".select__single-value");
  return v ? v.textContent : "(empty)";
}

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const office = comboValueFor("Preferred office location");
  const eng = comboValueFor("What type of engineering");
  const team = comboValueFor("Which team interests you most");
  const unfilled = ((report && report.unfilled) || []).map((e) =>
    typeof e === "string" ? e : e.label || ""
  );
  const teamRevealed = unfilled.find((l) => /which team interests/i.test(l));

  console.log("\n--- RESULT ---");
  console.log("office (answer bank)  :", JSON.stringify(office), office === "Seattle" ? "PASS" : "FAIL");
  console.log("engineering (ank bank):", JSON.stringify(eng), eng === "Machine Learning" ? "PASS" : "FAIL");
  console.log("team (no answer)      :", JSON.stringify(team), team === "(empty)" ? "PASS (not guessed)" : "FAIL");
  console.log("team options revealed :", teamRevealed ? "PASS" : "FAIL");
  console.log("revealed string       :", teamRevealed);
  console.log("unfilled              :", JSON.stringify(unfilled, null, 0));

  const ok =
    office === "Seattle" &&
    eng === "Machine Learning" &&
    team === "(empty)" &&
    !!teamRevealed && /Growth/.test(teamRevealed);
  console.log("\n" + (ok ? "REACTIVE-DROPDOWN E2E PASS" : "REACTIVE-DROPDOWN E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
