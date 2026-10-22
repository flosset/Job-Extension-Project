// widget-value-edit.test.js — correcting a saved widget's answer.
//
// Why this exists: a widget stores LITERAL values, so a widget captured last
// year keeps answering with last year's answer. For "are you authorized to
// work?" that is a real hazard — the answer can change while the widget keeps
// saying "Yes", and it will fill the next application with it. Before this, the
// only recourse was to forget the widget and re-answer the form by hand.
//
// Guarantees under test:
//   1. every field's value is shown, and is editable;
//   2. editing one value changes ONLY that value — structure, anchors and the
//      other fields are untouched;
//   3. a profile-bound value is shown but NOT editable (it is read fresh on
//      every run, so editing it here would be a lie);
//   4. the change is persisted;
//   5. an empty value is refused rather than silently blanking a widget.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR } = require("../_popup-source");
const POPUP_JS = require("../_popup-source").POPUP_JS;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(52)}: ${detail === undefined ? "" : String(detail) + " "}${cond ? "PASS" : "FAIL"}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHELL = `<!doctype html><html><body>
  <p id="status"></p>
  <div id="widgetSection" hidden><p id="widgetNote"></p><div id="widgetRows"></div>
    <button type="button" id="saveWidgetsBtn"></button>
    <button type="button" id="dismissWidgetsBtn"></button></div>
  <div id="recipeRows"></div><p id="recipeEmpty"></p>
</body></html>`;

function openPage(store) {
  const dom = new JSDOM(SHELL, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "chrome-extension://x/options.html"
  });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  w.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return Object.assign({}, store);
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (store[k] !== undefined) out[k] = store[k];
          });
          return out;
        },
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (k) => { delete store[k]; }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: { query: async () => [{ id: 7, url: "https://jobs.ashbyhq.com/x", title: "Apply" }] }
  };
  w.eval(
    POPUP_JS +
      "\n;window.__t = { editRecipeValue, renderRecipes, fillFormFromProfile, persist, S: JOB_AUTOFILL_SHARED, get recipeState() { return recipeState; } };"
  );
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, store };
}

// A learned Yes/No widget: ONE field, a LITERAL value — exactly what the new
// button-pair learner produces. The anchor is deliberately SHORT and
// distinctive, not the whole question: sanitizeRecipes clips every keyword at
// 40 characters, so a full question would be truncated into something that can
// never match the page again. (tests/learning/yesno-widget.test.js pins that.)
const YESNO_RECIPE = {
  id: "r1",
  host: "jobs.ashbyhq.com",
  name: "Are you currently legally authorized to work in the US?",
  fingerprint: "are you currently legally authorized to work in the us",
  anchor: ["legally authorized work us"],
  confirm: [["yes"], ["no"]],
  addButton: [],
  dateFormat: "none",
  fields: { legallyauthorizedworkus: ["legally authorized work us"] },
  rows: [{ legallyauthorizedworkus: { source: "literal", value: "Yes" } }],
  uses: 1,
  createdAt: 1
};

// A References-style widget, so the "only that value changes" claim is testable.
const REF_RECIPE = {
  id: "r2",
  host: "boards.greenhouse.io",
  name: "References",
  fingerprint: "reference name reference email",
  anchor: ["reference name"],
  confirm: [["reference email"]],
  addButton: ["add another"],
  dateFormat: "none",
  fields: {
    refname: ["reference name"],
    refemail: ["reference email"],
    refphone: ["reference phone"]
  },
  rows: [
    {
      refname: { source: "literal", value: "Dana Referee" },
      refemail: { source: "profile", key: "email" },
      refphone: { source: "literal", value: "+1 555 000 1111" }
    }
  ],
  uses: 0,
  createdAt: 1
};

(async () => {
  const store = { jobProfile: { workAuthorized: "No" }, jobRecipes: { items: [YESNO_RECIPE, REF_RECIPE] } };
  const P = openPage(store);
  await sleep(80);

  const rows = P.d.querySelectorAll("#recipeRows .app-row");
  t("A: both saved widgets render", rows.length === 2, String(rows.length));
  t("overlap: current profile produces a warning",
    P.d.querySelectorAll(".widget-override").length === 1 &&
    P.d.querySelector(".widget-override").textContent.includes("work authorization"));
  const S = P.w.__t.S;
  const sponsorship = { ...YESNO_RECIPE, fingerprint: "do you require sponsorship" };
  t("overlap: sponsorship detected", S.profileKeyForWidget(sponsorship, { sponsorship: "Yes" }) === "sponsorship");
  t("overlap: missing profile answer has no warning", S.profileKeyForWidget(YESNO_RECIPE, {}) === "");
  t("overlap: graduation does not match authorization", S.profileKeyForWidget(
    { ...YESNO_RECIPE, fingerprint: "is your expected graduation date between june 2027 and june 2028" },
    { workAuthorized: "Yes", sponsorship: "No" }) === "");
  t("overlap: references do not match", S.profileKeyForWidget(REF_RECIPE, { email: "qa@example.com" }) === "");
  t("overlap: profile-bound widget does not override", S.profileKeyForWidget(
    { ...YESNO_RECIPE, rows: [{ legallyauthorizedworkus: { source: "profile", key: "workAuthorized" } }] },
    { workAuthorized: "Yes" }) === "");
  P.w.__t.fillFormFromProfile({});
  t("overlap: switching to empty profile removes warning", P.d.querySelectorAll(".widget-override").length === 0);
  await P.w.__t.persist({ workAuthorized: "Yes" });
  t("overlap: saving profile refreshes warning even when values agree", P.d.querySelectorAll(".widget-override").length === 1);

  const inputs = P.d.querySelectorAll("#recipeRows .widget-value input");
  t("B: one editable input per field", inputs.length === 4, String(inputs.length));

  // --- the Yes/No widget's single value, shown and editable --------------
  const nameInput = P.d.querySelector("#recipeRows .app-company");
  t("C: the widget name is still editable",
    !!nameInput && nameInput.value.indexOf("legally authorized") !== -1);

  // --- 3. a profile-bound value is disabled ------------------------------
  const disabled = Array.from(inputs).filter((i) => i.disabled);
  t("D: the profile-bound value is shown but not editable",
    disabled.length === 1 && disabled[0].placeholder.indexOf("profile:") === 0,
    disabled.length + " disabled");

  // --- 2/4. editing changes only that value, and persists ---------------
  const target = Array.from(inputs).filter((i) => !i.disabled)[0];
  t("E: the value starts as the learned answer", target.value === "Yes", target.value);
  target.value = "No";
  target.dispatchEvent(new P.w.Event("change", { bubbles: true }));
  await sleep(80);

  const saved = store.jobRecipes.items;
  const yesno = saved.filter((r) => r.id === "r1")[0];
  const ref = saved.filter((r) => r.id === "r2")[0];

  t("F: the edited value is persisted",
    yesno.rows[0].legallyauthorizedworkus.value === "No",
    JSON.stringify(yesno.rows[0]));
  t("F: the literal stays a literal",
    yesno.rows[0].legallyauthorizedworkus.source === "literal");
  // NOTE: sanitizeRecipes sorts field and row keys alphabetically
  // (shared/widgets.js: `Object.keys(rawFields).sort()`), so equality must be
  // compared on CONTENT, not on JSON key order.
  const sameShape = (a, b) =>
    JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) &&
    Object.keys(a).sort().every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

  t("G: the anchor is untouched", yesno.anchor[0] === YESNO_RECIPE.anchor[0],
    JSON.stringify(yesno.anchor));
  t("G: the field set is untouched", sameShape(yesno.fields, YESNO_RECIPE.fields),
    JSON.stringify(yesno.fields));
  t("G: the confirm pair is untouched",
    JSON.stringify(yesno.confirm) === JSON.stringify(YESNO_RECIPE.confirm));

  // --- the OTHER widget was not touched ---------------------------------
  t("H: the second widget keeps its identity",
    ref.host === REF_RECIPE.host && ref.anchor[0] === REF_RECIPE.anchor[0] &&
    ref.name === REF_RECIPE.name);
  t("H: its fields are unchanged", sameShape(ref.fields, REF_RECIPE.fields));
  t("H: its literal phone is unchanged",
    ref.rows[0].refphone.value === "+1 555 000 1111");
  t("H: its profile binding survived",
    ref.rows[0].refemail.source === "profile" && ref.rows[0].refemail.key === "email");

  // --- 5. an empty value is refused -------------------------------------
  const again = Array.from(
    P.d.querySelectorAll("#recipeRows .widget-value input")
  ).filter((i) => !i.disabled)[0];
  again.value = "   ";  again.dispatchEvent(new P.w.Event("change", { bubbles: true }));
  await sleep(80);
  const after = store.jobRecipes.items.filter((r) => r.id === "r1")[0];
  t("I: an empty value does not blank the widget",
    after.rows[0].legallyauthorizedworkus.value === "No",
    JSON.stringify(after.rows[0]));

  const pending = openPage({ jobProfile: { workAuthorized: "No" },
    widgetCandidates: { candidates: [YESNO_RECIPE] } });
  await sleep(80);
  t("overlap: pending offer warns before saving",
    !!pending.d.querySelector("#widgetRows .widget-override"));
  pending.w.close();

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`WIDGET-VALUE-EDIT E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
