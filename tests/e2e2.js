// End-to-end test against the REAL test-form.html file.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS.map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8")).join("\n");
const html = fs.readFileSync(path.join(APP_DIR, "test-form.html"), "utf8");

const vc = new VirtualConsole();
vc.on("log", (...a) => console.log("  [page]", ...a));
vc.on("jsdomError", (e) => console.log("  [jsdomError]", e.message));

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;

window.Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
window.Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10, top: 0, left: 0 }; };

let report = null;
window.chrome = {
  storage: {
    local: {
      get: async () => ({
        jobProfile: {
          firstName: "Jane", gender: "Male", veteran: "I am a protected veteran",
          disability: "No, I do not have a disability"
        }
      })
    }
  },
  runtime: { sendMessage: (m) => { report = m; } }
};

console.log("combo controls in DOM:", document.querySelectorAll('[class*="select__control"]').length);
const ctrl = document.querySelector(".select__control");
if (ctrl) {
  const inp = ctrl.querySelector('input[role="combobox"]');
  console.log("control found, input role =", inp && inp.getAttribute("role"), "aria-labelledby =", inp && inp.getAttribute("aria-labelledby"));
}

window.eval(SOURCE);

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const first = document.getElementById("first_name").value;
  const genderSelect = document.querySelector('select#gender');
  const chosenEl = document.querySelector(".select__single-value");
  const chosen = chosenEl ? chosenEl.textContent : "(none)";
  const optsLeft = document.querySelectorAll(".select__option").length;
  const coverFile = document.getElementById("cover_file");
  const resumeFile = document.getElementById("resume_file");
  console.log("\n--- RESULT ---");
  console.log("first_name           :", JSON.stringify(first));
  console.log("native gender select :", genderSelect ? JSON.stringify(genderSelect.value) : "(none)");
  console.log("combobox chosen      :", JSON.stringify(chosen), chosen === "Man" ? "PASS" : "FAIL");
  console.log("options left open    :", optsLeft);
  console.log("cover file value     :", JSON.stringify(coverFile ? coverFile.value : "(none)"));
  console.log("report.status        :", report && report.status, report && report.status === "ok" ? "PASS" : "FAIL");
  console.log("report               :", JSON.stringify(report));
  const ok = first === "Jane" && chosen === "Man" && report && report.status === "ok";
  console.log("\n" + (ok ? "E2E PASS" : "E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
