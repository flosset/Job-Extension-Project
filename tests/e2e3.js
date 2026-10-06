// Verifies Strategy 2 (Enter-on-input) for a widget that IGNORES clicks and
// only commits via its keyboard handler.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SOURCE = require("./_popup-source").CONTENT_SCRIPTS.map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8")).join("\n");

const html = `<!DOCTYPE html><html><body>
  <label id="cb-gender-label">Gender</label>
  <div class="select__control" id="ctrl">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <input class="select__input" role="combobox" aria-labelledby="cb-gender-label" readonly />
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
let focusedText = null;

control.addEventListener("mousedown", () => {
  const menu = control.parentElement.querySelector(".cb-menu");
  menu.innerHTML = ["Man", "Woman", "Non-binary", "Decline to self-identify"]
    .map((c) => `<div class="select__option">${c}</div>`).join("");
});
// Hover sets the focused option; clicks are deliberately IGNORED.
document.addEventListener("mouseover", (e) => {
  if (e.target.classList && e.target.classList.contains("select__option")) focusedText = e.target.textContent;
});
document.addEventListener("mousemove", (e) => {
  if (e.target.classList && e.target.classList.contains("select__option")) focusedText = e.target.textContent;
});
input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !focusedText) return;
  const container = control.querySelector(".select__value-container");
  const ph = container.querySelector(".select__placeholder");
  if (ph) ph.remove();
  const v = document.createElement("div");
  v.className = "select__single-value";
  v.textContent = focusedText;
  container.insertBefore(v, container.firstChild);
  control.parentElement.querySelector(".cb-menu").innerHTML = "";
});

let report = null;
window.chrome = {
  storage: { local: { get: async () => ({ jobProfile: { gender: "Male" } }) } },
  runtime: { sendMessage: (m) => { report = m; } }
};

window.eval(SOURCE);

(async () => { await Promise.race([window.__jobAutofillRun, new Promise((r) => setTimeout(r, 15000))]);
  const v = document.querySelector(".select__single-value");
  const chosen = v ? v.textContent : "(none)";
  console.log("chosen via Enter    :", JSON.stringify(chosen), chosen === "Man" ? "PASS" : "FAIL");
  console.log("filled              :", report && report.filled);
  const ok = chosen === "Man" && report && report.filled === 1;
  console.log("\n" + (ok ? "STRATEGY-2 E2E PASS" : "STRATEGY-2 E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
