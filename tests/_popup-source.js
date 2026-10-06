// _popup-source.js — the UI scripts, in the same order the HTML pages load them.
//
// The UI is split into ui/core.js -> ui/storage.js -> ui/fill-runner.js ->
// ui/editor.js. Tests that exercise the UI must concatenate them in that exact
// order, so the list lives here once instead of in five suites.
"use strict";
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");
const POPUP_SCRIPTS = [
  "ui/core.js",
  "ui/storage.js",
  "ui/fill-runner.js",
  "ui/editor.js"
];

const POPUP_JS = POPUP_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

module.exports = { APP_DIR, POPUP_SCRIPTS, POPUP_JS };
