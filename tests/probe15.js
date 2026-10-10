// probe15.js — which inputs does the drop-zone heuristic claim?
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = path.resolve(__dirname, "..");
// The whole injected pipeline, in the shipped order (see _popup-source.js).
const SRC = require("./_popup-source").CONTENT_SRC;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "dangerously",
  pretendToBeVisual: true
});
const { window } = dom;
const document = window.document;
window.Element.prototype.getClientRects = () => [{ width: 1, height: 1 }];
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
  return input;
}
const plain = makeInput("resume_file", "Resume / CV");

const SEL = '[class*="drop"], [class*="upload"], [class*="attach"], [class*="file"]';
for (const input of JA.resumeFileInputs()) {
  const z = input.closest(SEL);
  console.log(
    `id=${input.id}\n  own class=${JSON.stringify(input.className)}\n  own class attr=${
      input.hasAttribute("class") ? JSON.stringify(input.getAttribute("class")) : "(absent)"
    }\n  zone=${z ? z.tagName + "." + JSON.stringify(z.className) : "null"}\n  parent=${input.parentElement.tagName}.${JSON.stringify(input.parentElement.className)}`
  );
  console.log("  matches own:", input.matches(SEL));
}
