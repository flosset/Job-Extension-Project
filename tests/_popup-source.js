// _popup-source.js — the UI scripts, in the same order the HTML pages load them.
//
// The UI is split across shared/*.js + ui/**/*.js, and the content scripts are
// listed in shared/index.js too. Tests that exercise either side must
// concatenate them in the same order the real pages do, so both lists live here
// once instead of in every suite.
"use strict";
const fs = require("fs");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");

const read = (file) => fs.readFileSync(path.join(APP_DIR, file), "utf8");

// The cross-context module: shared/index.js CREATES the object and holds the
// injected-file list; its siblings attach their rules to it. So evaluate
// index.js alone first — the list it defines tells us exactly which shared
// files to load, and in what order, with no second copy of that list to drift.
const INDEX_ONLY = (() => {
  const box = {};
  new Function(
    "window",
    read("shared/index.js") + "\n;window.JOB_AUTOFILL_SHARED = JOB_AUTOFILL_SHARED;"
  )(box);
  return box.JOB_AUTOFILL_SHARED;
})();

const SHARED_SCRIPTS = INDEX_ONLY.contentScripts.filter(
  (file) => file.indexOf("shared/") === 0
);

// Drift guard, both directions: every shared/ file the list names must exist,
// and no shared/ file on disk may be missing from the list. A rename or a new
// rule file can therefore never leave the injected run pointing at a missing
// file, or ship a file nothing loads.
if (SHARED_SCRIPTS[0] !== "shared/index.js") {
  throw new Error("shared/index.js must be first in contentScripts");
}
for (const file of SHARED_SCRIPTS) {
  if (!fs.existsSync(path.join(APP_DIR, file))) {
    throw new Error(file + " is listed in contentScripts but missing on disk");
  }
}
const orphanShared = fs
  .readdirSync(path.join(APP_DIR, "shared"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => "shared/" + name)
  .filter((file) => SHARED_SCRIPTS.indexOf(file) === -1);
if (orphanShared.length) {
  throw new Error(
    "shared/ file(s) not in contentScripts: " + orphanShared.join(", ")
  );
}

const SHARED_SOURCE = SHARED_SCRIPTS.map(read).join("\n");

// What popup.html loads, in order — read FROM THE PAGE rather than repeated
// here, so this list can never drift from what the extension actually ships
// (adding a file to the popup is enough; the tests pick it up).
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

// The injected files, taken from shared/index.js so the tests can never
// disagree with the extension about what gets injected or in what order.
// shared/*.js declares its exports with `var`, so evaluate the files and hand
// the result out explicitly rather than reading it off the sandbox.
const SHARED = (() => {
  const box = {};
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
  SHARED_SCRIPTS,
  POPUP_SCRIPTS,
  POPUP_JS,
  SHARED,
  CONTENT_SCRIPTS,
  CONTENT_SRC
};


