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

const read = (file) => fs.readFileSync(path.join(APP_DIR, file), "utf8");

// What popup.html loads, in order — read FROM THE PAGE rather than repeated
// here, so this list can never drift from what the extension actually ships
// (adding a ui/*.js file to the popup is enough; the tests pick it up).
const POPUP_SCRIPTS = (() => {
  const html = read("popup.html");
  const found = [];
  const pattern = /<script\s+src="([^"]+)"\s*>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    found.push(match[1]);
    match = pattern.exec(html);
  }
  if (found.length === 0) throw new Error("popup.html lists no scripts");
  return found;
})();

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

