// Verifies closeCombo() for a multi-select widget that IGNORES Escape/blur and
// only closes when its control is clicked again (toggled) â€” like Race/Ethnicity.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS.map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8")).join("\n");

const html = `<!DOCTYPE html><html><body>
  <label id="lbl">Race/Ethnicity</label>
  <div class="select__control" id="ctrl">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input class="select__input" role="combobox" aria-labelledby="lbl" aria-expanded="false" readonly />
    </div>
  </div>
  <div class="cb-menu"></div>
</body></html>`;

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
window.Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10, top: 0, left: 0 }; };

const control = document.getElementById("ctrl");
const input = control.querySelector("input");
const menu = control.parentElement.querySelector(".cb-menu");
const open = () => !!menu.innerHTML;

control.addEventListener("mousedown", () => {
  if (open()) { menu.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
  menu.innerHTML = ["American Indian or Alaskan Native", "Asian", "Black or African American", "White"]
    .map((c) => `<div class="select__option">${c}</div>`).join("");
  input.setAttribute("aria-expanded", "true");
});
// Multi-select: choosing keeps the menu OPEN.
document.addEventListener("click", (e) => {
  const option = e.target.closest && e.target.closest(".select__option");
  if (!option) return;
  const container = control.querySelector(".select__value-container");
  const ph = container.querySelector(".select__placeholder");
  if (ph) ph.remove();
  const v = document.createElement("div");
  v.className = "select__single-value";
  v.textContent = option.textContent;
  container.insertBefore(v, container.firstChild);
  // menu intentionally stays open
});
// Escape and blur are IGNORED (worst case).

let report = null;
window.chrome = {
  storage: { local: { get: async () => ({ jobProfile: { race: "Asian" } }) } },
  runtime: { sendMessage: (m) => { report = m; } }
};

window.eval(SOURCE);

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const v = document.querySelector(".select__single-value");
  const chosen = v ? v.textContent : "(none)";
  console.log("chosen              :", JSON.stringify(chosen), chosen === "Asian" ? "PASS" : "FAIL");
  console.log("menu still open     :", open());
  console.log("aria-expanded       :", input.getAttribute("aria-expanded"));
  console.log("filled              :", report && report.filled);
  const ok = chosen === "Asian" && !open() && report && report.filled === 1;
  console.log("\n" + (ok ? "MULTI-SELECT CLOSE PASS" : "MULTI-SELECT CLOSE FAIL"));
  process.exit(ok ? 0 : 1);
})();
