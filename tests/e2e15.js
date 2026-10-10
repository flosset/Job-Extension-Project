// e2e15.js — file-attach SAFETY. Three guarantees under test:
//   1. an input that already holds a file is never clobbered (kept, not replaced);
//   2. exactly ONE upload signal is produced, so a react-dropzone-style widget
//      (onDrop wired to BOTH the hidden input's change and the root drop
//      handler) is not called twice;
//   3. a drop-only widget that ignores `change` still gets the drop fallback,
//      and the result distinguishes "bytes written" from "widget showed it".
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = path.resolve(__dirname, "..");
const SRC = ["content/field-map.js", "content/dom-utils.js", "content/files.js"]
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "dangerously",
  pretendToBeVisual: true
});
const { window } = dom;
const document = window.document;
window.Element.prototype.getClientRects = () => [{ width: 1, height: 1 }];

// jsdom has no DataTransfer.
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
const JA = window.__JobAutofill;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(44)}: ${detail === undefined ? (cond ? "PASS" : "FAIL") : String(detail)} ${
      cond ? "PASS" : "FAIL"
    }`
  );
}

/** A bare resume input: no drop-zone ancestor. */
function makeInput(id, labelText) {
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "file";
  input.id = id;
  input.name = id;
  document.body.appendChild(label);
  document.body.appendChild(input);
  Object.defineProperty(input, "files", { writable: true, configurable: true, value: [] });
  return input;
}

/**
 * A drop-zone widget. mode "change" mirrors react-dropzone (onDrop wired to
 * the hidden input's change AND the root drop handler); mode "drop" mirrors a
 * widget that only listens for a drop.
 */
function makeZone(id, mode) {
  const zone = document.createElement("div");
  zone.className = "upload-zone";
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = "Resume / CV upload";
  const input = document.createElement("input");
  input.type = "file";
  input.id = id;
  input.name = id;
  zone.appendChild(label);
  zone.appendChild(input);
  document.body.appendChild(zone);
  Object.defineProperty(input, "files", { writable: true, configurable: true, value: [] });

  const stat = { onDropCalls: 0 };
  const accept = () => {
    stat.onDropCalls++;
    const name = input.files && input.files[0] ? input.files[0].name : "(none)";
    zone.appendChild(document.createTextNode(" " + name));
  };
  if (mode === "change") {
    input.addEventListener("change", accept);
    zone.addEventListener("drop", accept);
  } else {
    zone.addEventListener("drop", accept);
  }
  return { zone, input, stat };
}

const plain = makeInput("resume_file", "Resume / CV");
const keptInput = makeInput("resume_existing", "Resume / CV (already attached)");
const cover = makeInput("cover_file", "Cover Letter (file upload)");
const rdu = makeZone("resume_zone_change", "change");
const dropOnly = makeZone("resume_zone_drop", "drop");

const mine = new window.File(["MINE"], "mine.pdf", { type: "application/pdf" });
keptInput.files = [mine];

// Highlighting must skip anything that already holds a file (3 empty uploads).
const flaggedBefore = JA.highlightResumeFiles();
t("highlight flags only empty uploads (before)", flaggedBefore === 3, flaggedBefore);

const pdf = "data:application/pdf;base64," + Buffer.from("PDF-BYTES").toString("base64");

(async () => {
  const result = await JA.attachResumeFile({
    resumeFile: { name: "jane_resume.pdf", type: "application/pdf", dataUrl: pdf }
  });
  console.log("attach result :", JSON.stringify(result), "\n");

  t("plain upload attached", plain.files.length === 1 && plain.files[0].name === "jane_resume.pdf");
  t("existing file KEPT (not replaced)", keptInput.files[0] === mine, keptInput.files[0].name);
  t("kept counted as kept, not attached", result.kept === 1 && result.attached === 3, JSON.stringify(result));
  t("react-dropzone widget called ONCE", rdu.stat.onDropCalls === 1, rdu.stat.onDropCalls);
  t("drop-only widget called ONCE", dropOnly.stat.onDropCalls === 1, dropOnly.stat.onDropCalls);
  t("drop-only widget acknowledged", result.acknowledged === 2, result.acknowledged);
  t("cover letter untouched", cover.files.length === 0, cover.files.length);
  // Only the two real zone widgets count — the highlight marker itself must
  // not look like a drop zone (it used to, via a "file"-containing class).
  t("zones = only the 2 real widgets", result.zones === 2, result.zones);

  const flaggedAfter = JA.highlightResumeFiles();
  t("highlight flags nothing once filled", flaggedAfter === 0, flaggedAfter);

  const ok =
    result.attached === 3 &&
    result.kept === 1 &&
    result.zones === 2 &&
    result.acknowledged === 2 &&
    keptInput.files[0] === mine &&
    cover.files.length === 0 &&
    rdu.stat.onDropCalls === 1 &&
    dropOnly.stat.onDropCalls === 1 &&
    flaggedBefore === 3 &&
    flaggedAfter === 0;

  console.log(`\n${ok ? "FILE-SAFETY E2E PASS" : "FILE-SAFETY E2E FAIL"} (${pass} passed, ${fail} failed)`);
  process.exit(ok ? 0 : 1);
})();
