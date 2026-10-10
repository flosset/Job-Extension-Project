// End-to-end test for the resume AUTO-ATTACH path (feature 3 upgrade).
// jsdom has no DataTransfer, so we install a minimal polyfill and give each
// resume input a writable `files` property — this exercises the real
// JA.attachResumeFile() code in content/controls/files.js.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR: APP } = require("../_popup-source");
// The whole injected pipeline, in the shipped order (see _popup-source.js).
const SRC = require("../_popup-source").CONTENT_SRC;

const html = `<!doctype html><html><body>
  <label for="resume_file">Resume / CV upload</label>
  <input type="file" id="resume_file" name="resume_upload" />
  <label for="cover_file">Cover Letter (file upload)</label>
  <input type="file" id="cover_file" name="cover_letter" />
  <label for="photo">Headshot</label>
  <input type="file" id="photo" name="headshot" />
</body></html>`;

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.Element.prototype.getClientRects = () => [{ width: 1, height: 1 }];

// Minimal DataTransfer polyfill (jsdom doesn't implement it).
window.DataTransfer = class {
  constructor() {
    this._files = [];
    this.items = { add: (f) => this._files.push(f) };
  }
  get files() {
    return this._files;
  }
};

window.eval(SRC);

// Give the resume input a writable `files` property, as a real browser has.
const resume = document.getElementById("resume_file");
const cover = document.getElementById("cover_file");
const photo = document.getElementById("photo");
Object.defineProperty(resume, "files", { writable: true, configurable: true, value: [] });
Object.defineProperty(cover, "files", { writable: true, configurable: true, value: [] });
Object.defineProperty(photo, "files", { writable: true, configurable: true, value: [] });

const pdf = "data:application/pdf;base64," + Buffer.from("PDF-BYTES-HERE").toString("base64");

(async () => {
  // attachResumeFile is async now (it verifies the widget accepted the file),
  // so the returned value is a promise that must be awaited.
  const result = await window.eval(
    `window.__JobAutofill.attachResumeFile({ resumeFile: { name: "jane_resume.pdf", type: "application/pdf", dataUrl: ${JSON.stringify(pdf)} } })`
  );

  console.log("attach result        :", JSON.stringify(result));
  console.log("resume input files   :", resume.files.length, resume.files.length === 1 ? "PASS" : "FAIL");
  console.log("attached file name   :", resume.files[0] && resume.files[0].name, resume.files[0] && resume.files[0].name === "jane_resume.pdf" ? "PASS" : "FAIL");
  console.log("cover letter empty   :", cover.files.length === 0 ? "PASS" : "FAIL (resume leaked into cover letter)");
  console.log("headshot untouched   :", photo.files.length === 0 ? "PASS" : "FAIL");

  const ok = result.attached === 1 && result.kept === 0 && resume.files.length === 1 &&
    resume.files[0].name === "jane_resume.pdf" && cover.files.length === 0 &&
    photo.files.length === 0;
  console.log("\n" + (ok ? "ATTACH E2E PASS" : "ATTACH E2E FAIL"));
  process.exit(ok ? 0 : 1);
})();
