// e2e16.js — repeatable-section SAFETY. Guarantees under test:
//   1. surplus blocks are COUNTED but never deleted unless the caller opts in;
//   2. a confirmation dialog is accepted only if it APPEARED because of the
//      delete click we just made, and only if it is actually about deleting —
//      an unrelated open modal must never be clicked.
//   3. a control one pass has filled is CLAIMED (`used`): no later pass — a
//      page-wide pass or the section engine — can write the same field again.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP_DIR = "g:\\Programming\\Job Extension Project";
const SRC = require("./_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "dangerously",
  pretendToBeVisual: true
});
const { window } = dom;
const document = window.document;
window.Element.prototype.getClientRects = () => [{ width: 1, height: 1 }];
window.eval(SRC);
const JA = window.__JobAutofill;
const WORK = JA.SECTIONS.workExperience;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(46)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}
const blockCount = () => document.querySelectorAll("#work-section .exp-block").length;

/** One Work Experience block; `onDelete` overrides the default removal. */
function makeBlock(i, onDelete) {
  const b = document.createElement("div");
  b.className = "exp-block";
  const field = (labelText, id) => {
    const row = document.createElement("div");
    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    row.appendChild(label);
    row.appendChild(input);
    b.appendChild(row);
  };
  field("Job Title", "jt" + i);
  field("Company", "co" + i);
  field("From", "fr" + i);
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.addEventListener("click", () => (onDelete ? onDelete() : b.remove()));
  b.appendChild(del);
  return b;
}

function makeSection(count, onDeleteFor) {
  const old = document.getElementById("work-section");
  if (old) old.remove();
  const wrap = document.createElement("div");
  wrap.id = "work-section";
  for (let i = 0; i < count; i++) {
    wrap.appendChild(makeBlock(i, onDeleteFor && onDeleteFor(i)));
  }
  const add = document.createElement("button");
  add.textContent = "Add Another";
  wrap.appendChild(add);
  document.body.appendChild(wrap);
}

/** A dialog with click counters, added to the page. */
function addDialog(text, labels) {
  const d = document.createElement("div");
  d.setAttribute("role", "dialog");
  d.appendChild(document.createTextNode(text + " "));
  const counts = {};
  for (const label of labels) {
    const b = document.createElement("button");
    b.textContent = label;
    counts[label] = 0;
    b.addEventListener("click", () => counts[label]++);
    d.appendChild(b);
  }
  document.body.appendChild(d);
  return { d, counts };
}

const ENTRIES = [
  { title: "Engineer", company: "Acme", from: "2020-01" },
  { title: "Senior Engineer", company: "Globex", from: "2022-03" }
];
const profile = { workExperiences: ENTRIES };

(async () => {
  // --- A. Default: count the surplus, delete nothing -----------------------
  makeSection(4);
  const a = await JA.fillRepeatableSections(profile, new Set());
  t("A: fills the saved entries", a.filled > 0, a.filled);
  t("A: surplus counted", a.surplus === 2, a.surplus);
  t("A: nothing deleted by default", a.removed === 0, a.removed);
  t("A: page untouched (4 blocks remain)", blockCount() === 4, blockCount());
  t("A: entries written into blocks 1-2", document.getElementById("jt0").value === "Engineer" &&
      document.getElementById("jt1").value === "Senior Engineer",
    document.getElementById("jt0").value + "/" + document.getElementById("jt1").value);

  // --- B. Opt-in: the same run DOES delete --------------------------------
  makeSection(4);
  const b = await JA.fillRepeatableSections(profile, new Set(), { trim: true });
  t("B: surplus counted", b.surplus === 2, b.surplus);
  t("B: both leftovers removed", b.removed === 2, b.removed);
  t("B: page trimmed to 2 blocks", blockCount() === 2, blockCount());

  // --- C1. A pre-existing, unrelated modal must never be clicked -----------
  makeSection(1);
  const pre = addDialog("Change your password?", ["OK", "Cancel"]);
  let freshDelete = null;
  const block1 = document.querySelector("#work-section .exp-block");
  block1.querySelector("button").addEventListener("click", () => {
    freshDelete = addDialog("Are you sure you want to delete this entry?", [
      "Cancel",
      "Yes, delete"
    ]);
  });
  const deleted = await JA.deleteSectionBlock(block1, WORK);
  t("C1: delete control accepted", deleted === true, deleted);
  t("C1: unrelated modal OK NOT clicked", pre.counts["OK"] === 0, pre.counts["OK"]);
  t("C1: unrelated modal Cancel NOT clicked", pre.counts["Cancel"] === 0, pre.counts["Cancel"]);
  t(
    "C1: fresh delete confirm IS accepted",
    freshDelete && freshDelete.counts["Yes, delete"] === 1,
    freshDelete && freshDelete.counts["Yes, delete"]
  );
  t(
    "C1: its Cancel NOT clicked",
    freshDelete && freshDelete.counts["Cancel"] === 0,
    freshDelete && freshDelete.counts["Cancel"]
  );
  pre.d.remove();
  if (freshDelete) freshDelete.d.remove();

  // --- C2. A fresh dialog that is NOT about deleting is left alone ---------
  makeSection(1);
  let saveDialog = null;
  const block2 = document.querySelector("#work-section .exp-block");
  block2.querySelector("button").addEventListener("click", () => {
    saveDialog = addDialog("Save your progress?", ["OK", "Cancel"]);
  });
  await JA.deleteSectionBlock(block2, WORK);
  t("C2: non-delete OK NOT clicked", saveDialog.counts["OK"] === 0, saveDialog.counts["OK"]);
  t("C2: non-delete Cancel NOT clicked", saveDialog.counts["Cancel"] === 0, saveDialog.counts["Cancel"]);
  saveDialog.d.remove();

  // --- C3. A delete prompt whose only button is Cancel is left alone -------
  makeSection(1);
  let cancelOnly = null;
  const block3 = document.querySelector("#work-section .exp-block");
  block3.querySelector("button").addEventListener("click", () => {
    cancelOnly = addDialog("Delete this entry?", ["Cancel"]);
  });
  await JA.deleteSectionBlock(block3, WORK);
  t(
    "C3: delete prompt with only Cancel NOT clicked",
    cancelOnly.counts["Cancel"] === 0,
    cancelOnly.counts["Cancel"]
  );
  cancelOnly.d.remove();

  // --- C4. A generic OK IS accepted when the dialog proves it is a delete --
  makeSection(1);
  let genericOk = null;
  const block4 = document.querySelector("#work-section .exp-block");
  block4.querySelector("button").addEventListener("click", () => {
    genericOk = addDialog("This entry will be deleted. Continue?", ["OK"]);
  });
  await JA.deleteSectionBlock(block4, WORK);
  t("C4: generic OK accepted for a delete prompt", genericOk.counts["OK"] === 1, genericOk.counts["OK"]);
  genericOk.d.remove();

  // --- D. the run-wide `used` set is honoured END TO END -------------------
  // A later pass (the widget-learning engine, or any page-wide pass) must never
  // be handed a control an earlier pass already filled. Guard the mechanism.
  makeSection(1);
  const dBlock = document.querySelector("#work-section .exp-block");
  const dField = document.getElementById("jt0");
  t(
    "D1: without `used` the field is found",
    JA.findFieldByKeywords(dBlock, ["job title"]) === dField
  );
  t(
    "D2: a used field is skipped",
    JA.findFieldByKeywords(dBlock, ["job title"], { used: new Set([dField]) }) === null
  );

  // --- E. a pass does not overwrite a field another pass owns -------------
  makeSection(1);
  const ownField = document.getElementById("jt0");
  ownField.value = "PRESET BY ANOTHER PASS";
  const claims = new Set([ownField]);
  const oneEntry = { workExperiences: [ENTRIES[0]] };
  const e = await JA.fillRepeatableSections(oneEntry, claims);
  t("E1: the owned field keeps its value", ownField.value === "PRESET BY ANOTHER PASS", ownField.value);
  t("E2: its sibling still fills", document.getElementById("co0").value === "Acme", document.getElementById("co0").value);
  t("E3: the owned field is not counted", e.filled === 2, e.filled);
  t(
    "E4: what was filled is now claimed",
    claims.has(document.getElementById("co0")) && claims.has(document.getElementById("fr0")),
    claims.size
  );

  // --- F. the section claims every one of its fields once it has run -------
  // (Belt and braces with E: fillSection marks the block, so a pass that runs
  // AFTER the sections cannot take a widget field either.)
  makeSection(1);
  const after = new Set();
  await JA.fillRepeatableSections(oneEntry, after);
  t(
    "F1: block fields are claimed after the run",
    after.has(document.getElementById("jt0")) &&
      after.has(document.getElementById("co0")) &&
      after.has(document.getElementById("fr0")),
    after.size
  );

  // --- G. the dispatcher itself claims what it fills ----------------------
  makeSection(1);
  const gUsed = new Set();
  const gField = document.getElementById("jt0");
  const g1 = await JA.fillFieldByKeywords(document, ["job title"], "Engineer II", { used: gUsed });
  t("G1: a filled field is reported and claimed", g1 === true && gUsed.has(gField), g1);
  const g2 = await JA.fillFieldByKeywords(document, ["job title"], "Overwrite Me", { used: gUsed });
  t("G2: a claimed field is not filled twice", g2 === false, g2);
  t("G3: and its value is untouched", gField.value === "Engineer II", gField.value);

  console.log(
    `\n${fail === 0 ? "REPEATABLE-SAFETY E2E PASS" : "REPEATABLE-SAFETY E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();

