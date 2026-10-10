// End-to-end test for features 2, 3 & 4 against the REAL test-form.html.
//   feature 2 â€” Yes/No radio pairs (work authorization + sponsorship)
//   feature 3 â€” resume/CV file drop-zone highlighting
//   feature 4 â€” custom fuzzy key/value snippets ("Desired Salary")
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const { APP_DIR } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");
const html = fs.readFileSync(path.join(APP_DIR, "test-form.html"), "utf8");

const vc = new VirtualConsole();
vc.on("log", (...a) => console.log("  [page]", ...a));
vc.on("jsdomError", (e) => console.log("  [jsdomError]", e.message));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;
const { document } = window;

window.Element.prototype.getClientRects = function () {
  return [{ width: 10, height: 10 }];
};
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 10, height: 10, top: 0, left: 0 };
};

let report = null;
window.chrome = {
  storage: {
    local: {
      get: async () => ({
        jobProfile: {
          firstName: "Jane",
          workAuthorized: "Yes",
          sponsorship: "No",
          customSnippets: [{ key: "desired salary", value: "$120,000" }]
        }
      })
    }
  },
  runtime: {
    sendMessage: (m) => {
      report = m;
    }
  }
};

window.eval(SOURCE);

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const workYes = document.querySelector('input[name="work_auth"][value="yes"]');
  const workNo = document.querySelector('input[name="work_auth"][value="no"]');
  const sponYes = document.querySelector('input[name="sponsorship"][value="yes"]');
  const sponNo = document.querySelector('input[name="sponsorship"][value="no"]');
  const salary = document.getElementById("desired_salary");
  const resumeZone = document.querySelector("[data-ja-dropzone]");

  console.log("\n--- RESULT ---");
  console.log("work_auth  Yes checked :", workYes.checked, workYes.checked ? "PASS" : "FAIL");
  console.log("work_auth  No  checked :", workNo.checked, !workNo.checked ? "PASS" : "FAIL");
  console.log("sponsorship Yes checked:", sponYes.checked, !sponYes.checked ? "PASS" : "FAIL");
  console.log("sponsorship No  checked:", sponNo.checked, sponNo.checked ? "PASS" : "FAIL");
  console.log("snippet salary value   :", JSON.stringify(salary.value), salary.value === "$120,000" ? "PASS" : "FAIL");
  console.log("resume zone flagged    :", !!resumeZone, resumeZone ? "PASS" : "FAIL");
  console.log("report                 :", JSON.stringify(report));

  const ok =
    workYes.checked && !workNo.checked && sponNo.checked && !sponYes.checked &&
    salary.value === "$120,000" && !!resumeZone &&
    report && report.status === "ok";
  console.log("\n" + (ok ? "E2E PASS" : "E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
