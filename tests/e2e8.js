// End-to-end test for the expanded standard profile fields + DATE handling
// (input[type=date] normalization and month/year <select> pairs).
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP, "test-form.html"), "utf8");

const vc = new VirtualConsole();
vc.on("log", (...a) => console.log("  [page]", ...a));

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
window.Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0 });

window.chrome = {
  storage: {
    local: {
      get: async () => ({
        jobProfile: {
          firstName: "Jane",
          email: "jane@example.com",
          currentCompany: "Acme Corp",
          currentTitle: "Software Engineer",
          school: "State University",
          yearsExperience: "5",
          graduationDate: "May 2026",
          startDate: "07/15/2026",
          address: "1 Main St",
          city: "Austin"
        }
      })
    }
  },
  runtime: { sendMessage: () => {} }
};

window.eval(SOURCE);

function val(id) { return document.getElementById(id).value; }
function optionText(select) {
  const o = select.options[select.selectedIndex];
  return o ? o.textContent : "(none)";
}

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const gradInput = val("grad_date");
  const startInput = val("start_date");
  const monthSel = document.querySelector('select[name="grad_month"]');
  const yearSel = document.querySelector('select[name="grad_year"]');
  const monthText = optionText(monthSel);
  const yearText = optionText(yearSel);

  const checks = [
    ["current_company       ", val("current_company"), "Acme Corp"],
    ["job_title             ", val("job_title"), "Software Engineer"],
    ["school                ", val("school"), "State University"],
    ["years_experience      ", val("years_exp"), "5"],
    ["street_address        ", val("street_address"), "1 Main St"],
    ["city                  ", val("city"), "Austin"],
    ["email (not stolen)    ", val("emailAddress"), "jane@example.com"],
    ["grad_date (type=date) ", gradInput, "2026-05-01"],
    ["start_date (type=date)", startInput, "2026-07-15"],
    ["grad_month (select)   ", monthText, "May"],
    ["grad_year (select)    ", yearText, "2026"]
  ];

  console.log("--- RESULT ---");
  let ok = true;
  for (const [name, got, want] of checks) {
    const pass = got === want;
    ok = ok && pass;
    console.log(`${name}: ${JSON.stringify(got)} ${pass ? "PASS" : "FAIL (want " + JSON.stringify(want) + ")"}`);
  }
  console.log("\n" + (ok ? "FIELDS+DATES E2E PASS" : "FIELDS+DATES E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
