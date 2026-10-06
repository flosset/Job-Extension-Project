"use strict";
const fs = require("fs"); const path = require("path");
const { JSDOM } = require("jsdom");
const APP = "g:\\Programming\\Job Extension Project";
const SRC = ["content/field-map.js","content/dom-utils.js","content/combobox.js","content/radios.js","content/files.js","content/autofill.js"]
  .map(f => fs.readFileSync(path.join(APP, f), "utf8")).join("\n");
const html = `<!doctype html><html><body>
  <label for="resume_file">Resume / CV upload</label>
  <input type="file" id="resume_file" name="resume_upload" />
  <label for="attach_cv">Attach your CV</label>
  <input type="file" id="attach_cv" name="cv" />
  <label for="photo">Headshot</label>
  <input type="file" id="photo" name="headshot" />
</body></html>`;
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom; const { document } = window;
window.Element.prototype.getClientRects = () => [{width:1,height:1}];
window.chrome = { storage: { local: { get: async () => ({ jobProfile: { firstName: "Jane" } }) } }, runtime: { sendMessage: () => {} } };
window.eval(SRC);
setTimeout(() => {
  const r = document.getElementById("resume_file");
  const c = document.getElementById("attach_cv");
  const p = document.getElementById("photo");
  console.log("resume_file (Resume) flagged :", r.classList.contains("ja-file-dropzone") ? "PASS" : "FAIL");
  console.log("attach_cv   (CV)     flagged :", c.classList.contains("ja-file-dropzone") ? "PASS" : "FAIL");
  console.log("photo       (Headshot) skipped:", !p.classList.contains("ja-file-dropzone") ? "PASS" : "FAIL");
  const style = document.getElementById("__jobAutofillFileStyle");
  console.log("injected <style> present      :", style ? "PASS" : "FAIL");
  if (style) console.log("\n--- injected CSS ---\n" + style.textContent);
}, 3500);
