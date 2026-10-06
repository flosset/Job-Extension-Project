// _popup-source.js — the UI scripts, in the same order the HTML pages load them.
//
// The UI is split across shared.js + ui/*.js, and the content scripts are listed
// in shared.js too. Tests that exercise either side must concatenate them in the
// same order the real pages do, so both lists live here once instead of in every
// suite.
"use strict";
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");

// What popup.html and options.html load, in order.
const POPUP_SCRIPTS = [
  "shared.js",
  "ui/core.js",
  "ui/storage.js",
  "ui/learned.js",
  "ui/fill-runner.js",
  "ui/editor.js"
];

const read = (file) => fs.readFileSync(path.join(APP_DIR, file), "utf8");

const POPUP_JS = POPUP_SCRIPTS.map(read).join("\n");

// The injected files, taken from shared.js so the tests can never disagree with
// the extension about what gets injected or in what order.
const SHARED_SOURCE = read("shared.js");
const SHARED = (() => {
  const box = {};
  // shared.js declares its exports with `var`, so evaluate it and hand the
  // result out explicitly rather than trying to read it off the sandbox.
  new Function(
    "window",
    SHARED_SOURCE + "\n;window.JOB_AUTOFILL_SHARED = JOB_AUTOFILL_SHARED;"
  )(box);
  return box.JOB_AUTOFILL_SHARED;
})();
const CONTENT_SCRIPTS = SHARED.contentScripts;
const CONTENT_SRC = CONTENT_SCRIPTS.map(read).join("\n");

module.exports = {
  APP_DIR,
  POPUP_SCRIPTS,
  POPUP_JS,
  SHARED,
  CONTENT_SCRIPTS,
  CONTENT_SRC
};

