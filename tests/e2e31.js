// e2e31.js — "remember this widget".
//
// The feature only earns its keep if it is predictable AND safe, so this suite
// is as much about what is REFUSED as about what is learned:
//
//   * a repeated group you filled by hand        -> offered as a candidate
//   * a single field (not a group)               -> never offered
//   * only one field filled                      -> not sure enough, not offered
//   * a widget whose fields have no labels       -> refused, and reported why
//   * a widget a built-in section already covers -> never offered
//   * a candidate                                -> NEVER applied until saved
//   * a saved widget                             -> replayed through the same
//                                                   guarded engine, and it
//                                                   claims its fields
//   * a ROTTEN saved widget                      -> does nothing at all
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const {
  POPUP_JS,
  CONTENT_SRC,
  CONTENT_SCRIPTS,
  SHARED
} = require("./_popup-source");

const SITE = "https://boards.example.com/apply";

// Two reference blocks (as if "+" had been pressed twice), an unlabelled
// widget, and a widget the built-in education section already covers.
const FIXTURE = `<!doctype html><html><body>
  <label for="firstName">First Name</label><input id="firstName" type="text" />

  <h2>References</h2>
  <div id="refs">
    <div class="ref-block">
      <label for="refName0">Reference Name</label><input id="refName0" type="text" />
      <label for="refEmail0">Reference Email</label><input id="refEmail0" type="text" />
      <label for="refPhone0">Reference Phone</label><input id="refPhone0" type="text" />
    </div>
    <div class="ref-block">
      <label for="refName1">Reference Name</label><input id="refName1" type="text" />
      <label for="refEmail1">Reference Email</label><input id="refEmail1" type="text" />
      <label for="refPhone1">Reference Phone</label><input id="refPhone1" type="text" />
    </div>
  </div>
  <button type="button">Add another reference</button>

  <h2>Mystery</h2>
  <div id="mystery">
    <div class="m-block"><input id="m0a" /><input id="m0b" /></div>
    <div class="m-block"><input id="m1a" /><input id="m1b" /></div>
  </div>
  <button type="button">Add another</button>

  <h2>Education</h2>
  <div id="edu">
    <div class="edu-block">
      <label for="school0">School or University</label><input id="school0" type="text" />
      <label for="degree0">Degree</label><input id="degree0" type="text" />
    </div>
    <div class="edu-block">
      <label for="school1">School or University</label><input id="school1" type="text" />
      <label for="degree1">Degree</label><input id="degree1" type="text" />
    </div>
  </div>
  <button type="button">Add another</button>
</body></html>`;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(56)}: ${
      detail === undefined ? "" : String(detail) + " "
    }${cond ? "PASS" : "FAIL"}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A storage stub with real get/set/remove semantics. */
function storageStub(store) {
  return {
    local: {
      get: async (key) => {
        if (typeof key === "string") return { [key]: store[key] };
        if (Array.isArray(key)) {
          const out = {};
          key.forEach((k) => {
            out[k] = store[k];
          });
          return out;
        }
        return Object.assign({}, store);
      },
      set: async (obj) => {
        Object.assign(store, obj);
      },
      remove: async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          delete store[k];
        });
      }
    }
  };
}

/** Load a page with the REAL content scripts, run the fill, return handles. */
async function pageWith(profile, store) {
  const box = store || { jobProfile: profile || {} };
  if (!box.jobProfile) box.jobProfile = profile || {};
  const dom = new JSDOM(FIXTURE, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: SITE
  });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  w.chrome = {
    storage: storageStub(box),
    runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } }
  };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun; // the fill itself, then learning is armed
  return { w, d: w.document, store: box, JA: w.__JobAutofill };
}

/** Commit a value the way a user does: set it, then fire change. */
function commit(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}

const id = (page, name) => page.d.getElementById(name);

/** The slug whose keywords include `keyword`. */
const slugForKeyword = (recipe, keyword) =>
  Object.keys(recipe.fields || {}).find(
    (key) => (recipe.fields[key] || []).indexOf(keyword) !== -1
  );

(async () => {
  // ---- A. the engine is in the real injected list, and exposed ------------
  t(
    "A: widget-learn.js is in the injected list",
    CONTENT_SCRIPTS.indexOf("content/widget-learn.js") >= 0
  );

  const B = await pageWith({ firstName: "Jane" });
  t("A: armWidgetLearning is exposed", typeof B.JA.armWidgetLearning === "function");
  t("A: fillLearnedWidgets is exposed", typeof B.JA.fillLearnedWidgets === "function");
  t("A: the guarded engine is shared", typeof B.JA.fillSectionBlocks === "function");

  // ---- B. a repeated group you fill by hand becomes a CANDIDATE -----------
  // This is the user's own story: "+" twice, then two sections filled in.
  commit(B.w, id(B, "refName0"), "Bob Smith");
  commit(B.w, id(B, "refEmail0"), "bob@corp.com");
  commit(B.w, id(B, "refPhone0"), "555-0100");
  commit(B.w, id(B, "refName1"), "Alice Jones");
  commit(B.w, id(B, "refEmail1"), "alice@corp.com");
  await sleep(900);

  const pending = (B.store.widgetCandidates || {}).candidates || [];
  const cand = pending[0];
  t("B: the widget is offered", pending.length === 1, pending.length);
  t("B: it is keyed to the site", !!cand && cand.host === "boards.example.com", cand && cand.host);
  t("B: it is named after its heading", !!cand && cand.name === "References", cand && cand.name);
  t("B: the field set is inferred", !!cand && Object.keys(cand.fields).length === 3, cand && Object.keys(cand.fields).length);
  t("B: the anchor is a real label", !!cand && cand.anchor.length === 1 && /reference/.test(cand.anchor[0]), cand && cand.anchor[0]);
  t("B: the other labels confirm the block", !!cand && cand.confirm.length === 2, cand && cand.confirm.length);
  t("B: the add control is recorded", !!cand && cand.addButton.indexOf("add another") !== -1, cand && JSON.stringify(cand.addButton));
  t("B: both blocks get a row each", !!cand && cand.rows.length === 2, cand && cand.rows.length);

  const nameSlug = slugForKeyword(cand, "reference name");
  const emailSlug = slugForKeyword(cand, "reference email");
  const phoneSlug = slugForKeyword(cand, "reference phone");
  t("B: every filled field got a slug", !!nameSlug && !!emailSlug && !!phoneSlug);
  t(
    "B: block one holds its own three values",
    !!nameSlug && cand.rows[0][nameSlug].value === "Bob Smith" &&
      cand.rows[0][emailSlug].value === "bob@corp.com" &&
      cand.rows[0][phoneSlug].value === "555-0100"
  );
  t(
    "B: block two holds its own two values",
    !!nameSlug && cand.rows[1][nameSlug].value === "Alice Jones" &&
      cand.rows[1][emailSlug].value === "alice@corp.com",
    !!cand && JSON.stringify(cand.rows[1])
  );
  t(
    "B: values the profile does not hold are kept as literals",
    cand.rows[0][emailSlug].source === "literal",
    cand.rows[0][emailSlug].source
  );

  // ---- C. what is NOT a widget -------------------------------------------
  // C1: a lone field is not a group.
  const C1 = await pageWith({ firstName: "Jane" });
  commit(C1.w, id(C1, "firstName"), "Janet");
  await sleep(800);
  t(
    "C1: a lone field is never offered",
    ((C1.store.widgetCandidates || {}).candidates || []).length === 0
  );

  // C2: one filled field is not enough to be sure.
  const C2 = await pageWith({ firstName: "Jane" });
  commit(C2.w, id(C2, "refName0"), "Bob");
  await sleep(800);
  t(
    "C2: one filled field is not sure enough",
    ((C2.store.widgetCandidates || {}).candidates || []).length === 0
  );

  // C3: a widget whose fields have no readable labels is refused AND reported.
  const C3 = await pageWith({ firstName: "Jane" });
  commit(C3.w, id(C3, "m0a"), "alpha");
  commit(C3.w, id(C3, "m0b"), "beta");
  await sleep(800);
  t(
    "C3: an unlabelled widget is refused",
    ((C3.store.widgetCandidates || {}).candidates || []).length === 0
  );
  t(
    "C3: ...and the refusal is reported",
    ((C3.store.widgetCandidates || {}).skipped || []).length >= 1,
    JSON.stringify((C3.store.widgetCandidates || {}).skipped)
  );

  // C4: a widget a built-in section already covers is never offered.
  const C4 = await pageWith({ firstName: "Jane" });
  commit(C4.w, id(C4, "school0"), "State University");
  commit(C4.w, id(C4, "degree0"), "BS");
  await sleep(800);
  t(
    "C4: a widget the built-ins cover is never offered",
    ((C4.store.widgetCandidates || {}).candidates || []).length === 0
  );

  // ---- D. a candidate is NEVER applied until you save it ------------------
  const D = await pageWith(null, {
    jobProfile: { firstName: "Jane" },
    widgetCandidates: { candidates: [JSON.parse(JSON.stringify(cand))], skipped: [] }
  });
  id(D, "refEmail0").value = "";
  const pendingRun = await D.JA.fillLearnedWidgets(D.store.jobProfile, new Set());
  t(
    "D: a pending candidate fills nothing",
    pendingRun.filled === 0 && pendingRun.applied.length === 0,
    JSON.stringify(pendingRun)
  );
  t(
    "D: and is not in the saved list",
    !D.store.jobRecipes || (D.store.jobRecipes.items || []).length === 0
  );

  // ---- E. once SAVED, the same definition replays through the engine ------
  const saved = JSON.parse(JSON.stringify(cand));
  const E = await pageWith(null, {
    jobProfile: { firstName: "Jane" },
    jobRecipes: { items: [saved] }
  });
  // Clear the widget: on the real page the fill pipeline runs first, here we are
  // proving the REPLAY on its own.
  ["refName0", "refEmail0", "refPhone0", "refName1", "refEmail1"].forEach((n) => {
    id(E, n).value = "";
  });
  const blocksBefore = E.d.querySelectorAll("#refs .ref-block").length;
  const replay = await E.JA.fillLearnedWidgets(E.store.jobProfile, new Set());
  await sleep(60);
  t("E: the saved widget replays", replay.filled > 0, replay.filled);
  t("E: one entry is reported", replay.applied.length === 1, replay.applied.length);
  t("E: block one is filled", id(E, "refName0").value === "Bob Smith" && id(E, "refEmail0").value === "bob@corp.com");
  t("E: block two is filled too", id(E, "refName1").value === "Alice Jones", id(E, "refName1").value);
  t("E: no block was added or removed", E.d.querySelectorAll("#refs .ref-block").length === blocksBefore, blocksBefore);
  t(
    "E: usage is recorded for the profile page",
    (E.store.jobRecipes.items[0].uses || 0) >= 1 && E.store.jobRecipes.items[0].lastUsedAt > 0,
    JSON.stringify({ uses: E.store.jobRecipes.items[0].uses, lastUsedAt: !!E.store.jobRecipes.items[0].lastUsedAt })
  );

  // ---- F. a PROFILE-sourced field is resolved fresh on every run ----------
  const patched = {
    host: "boards.example.com",
    name: "References",
    anchor: ["reference phone"],
    confirm: [["reference name"], ["reference email"]],
    addButton: ["add another"],
    fields: { refname: ["reference name"], refphone: ["reference phone"] },
    rows: [
      {
        refname: { source: "profile", key: "firstName" },
        refphone: { source: "literal", value: "555-9999" }
      }
    ]
  };
  const F = await pageWith(null, {
    jobProfile: { firstName: "Fresh Name" },
    jobRecipes: { items: [patched] }
  });
  ["refName0", "refPhone0"].forEach((n) => (id(F, n).value = ""));
  await F.JA.fillLearnedWidgets(F.store.jobProfile, new Set());
  t("F: a profile-sourced field resolves fresh", id(F, "refName0").value === "Fresh Name", id(F, "refName0").value);
  t("F: a literal field keeps its stored value", id(F, "refPhone0").value === "555-9999", id(F, "refPhone0").value);

  // ---- G. a ROTTEN definition is inert, not dangerous ---------------------
  const rotten = {
    host: "boards.example.com",
    name: "References (stale)",
    // The site renamed the field: this anchor no longer exists anywhere.
    anchor: ["attachment name"],
    confirm: [["attachment file"]],
    fields: { a: ["attachment name"] },
    rows: [{ a: { source: "literal", value: "nope" } }]
  };
  const G = await pageWith(null, {
    jobProfile: { firstName: "Jane" },
    jobRecipes: { items: [rotten] }
  });
  const beforeValues = ["refName0", "refEmail0", "refPhone0", "refName1"].map((n) => id(G, n).value);
  const rottenRun = await G.JA.fillLearnedWidgets(G.store.jobProfile, new Set());
  await sleep(60);
  t("G: a rotten definition fills nothing", rottenRun.filled === 0 && rottenRun.applied.length === 0, JSON.stringify(rottenRun));
  t(
    "G: and touches not one field",
    ["refName0", "refEmail0", "refPhone0", "refName1"].every((n, i) => id(G, n).value === beforeValues[i])
  );
  t("G: and never clicks an add control", G.d.querySelectorAll("#refs .ref-block").length === 2);
  t("G: and it is not counted as used", (G.store.jobRecipes.items[0].uses || 0) === 0);

  // ---- H. storage rules, and the conservative binding rule ----------------
  t(
    "H: a recipe with no host is dropped",
    SHARED.sanitizeRecipes({ items: [{ host: "", anchor: ["x"], fields: { a: ["a"] }, rows: [{ a: { value: "v" } }] }] }).items.length === 0
  );
  t(
    "H: a recipe with no fields is dropped",
    SHARED.sanitizeRecipes({ items: [{ host: "h.com", anchor: ["x"], fields: {}, rows: [] }] }).items.length === 0
  );
  t(
    "H: a good recipe survives with its rows",
    (() => {
      const out = SHARED.sanitizeRecipes({
        items: [{ host: "H.com", anchor: ["Ref Name"], name: "Refs", fields: { refname: ["Ref Name"] }, rows: [{ refname: { source: "literal", value: "Bob" } }] }]
      }).items;
      return out.length === 1 && out[0].host === "h.com" && out[0].rows.length === 1 && !!out[0].id;
    })()
  );
  t(
    "H: a row mentioning an unknown field is dropped",
    (() => {
      const out = SHARED.sanitizeRecipes({
        items: [{ host: "h.com", anchor: ["x"], fields: { a: ["a"] }, rows: [{ a: { source: "literal", value: "ok" }, zzz: { source: "literal", value: "no" } }] }]
      }).items;
      return out.length === 1 && Object.keys(out[0].rows[0]).length === 1;
    })()
  );
  t(
    "H: a profile source needs a key",
    SHARED.sanitizeRecipes({ items: [{ host: "h.com", anchor: ["x"], fields: { a: ["a"] }, rows: [{ a: { source: "profile" } }] }] }).items.length === 0
  );

  const bind = B.JA.widgetLearnInternals.profileKeyFor;
  t(
    "H: a value that IS a profile value binds to it",
    bind("Reference Email", "bob@corp.com", { email: "bob@corp.com" }) === "email"
  );
  t(
    "H: a value that is NOT a profile value stays a literal",
    bind("Reference Email", "bob@corp.com", { email: "other@corp.com" }) === ""
  );

  // ---- I. the offer, the Save, and the stale-delete on the profile page ----
  const WIDGET_SHELL = (page) => `<!doctype html><html><body data-page="${page}">
    <p id="status"></p>
    <div id="widgetSection" hidden><p id="widgetNote"></p><div id="widgetRows"></div>
      <button type="button" id="saveWidgetsBtn"></button>
      <button type="button" id="dismissWidgetsBtn"></button></div>
    <div id="recipeRows"></div><p id="recipeEmpty"></p>
  </body></html>`;

  function openWidgetPage(store, page) {
    const dom = new JSDOM(WIDGET_SHELL(page), {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: "chrome-extension://x/page.html"
    });
    const w = dom.window;
    w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
    w.chrome = {
      storage: storageStub(store),
      runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
      tabs: {
        query: async () => [
          { id: 7, url: "https://boards.example.com/apply", title: "Apply" }
        ]
      }
    };
    w.eval(POPUP_JS);
    w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
    return { w, d: w.document, store };
  }

  const uiStore = {
    jobProfile: { firstName: "Jane" },
    widgetCandidates: { candidates: [JSON.parse(JSON.stringify(cand))], skipped: ["Mystery"] }
  };
  const I = openWidgetPage(uiStore, "popup");
  await sleep(80);
  t("I: the popup offers the pending widget", I.d.getElementById("widgetSection").hidden === false);
  t(
    "I: it says what the widget is",
    /References/.test(I.d.getElementById("widgetRows").textContent),
    I.d.getElementById("widgetRows").textContent
  );
  t(
    "I: and it says nothing is saved yet",
    /Nothing is saved until you click Save/.test(I.d.getElementById("widgetNote").textContent)
  );
  t(
    "I: the refused widget is explained",
    /could not be learned/.test(I.d.getElementById("widgetNote").textContent)
  );

  I.d.getElementById("saveWidgetsBtn").click();
  await sleep(80);
  t(
    "I: Save writes the definition",
    (uiStore.jobRecipes && uiStore.jobRecipes.items.length) === 1,
    uiStore.jobRecipes && uiStore.jobRecipes.items.length
  );
  t("I: the definition has an id and a created-at", !!uiStore.jobRecipes.items[0].id && uiStore.jobRecipes.items[0].createdAt > 0);
  t("I: the offer clears once accepted", uiStore.widgetCandidates.candidates.length === 0);
  t("I: the section hides", I.d.getElementById("widgetSection").hidden === true);
  t("I: and it reports what it did", /Saved 1 widget/.test(I.d.getElementById("status").textContent), I.d.getElementById("status").textContent);

  // The profile page lists it, with when it was last used, and can delete it.
  const O = openWidgetPage(uiStore, "options");
  await sleep(80);
  const savedRow = O.d.querySelector("#recipeRows .app-row");
  t("I: the profile page lists the widget", !!savedRow);
  t(
    "I: showing its site and usage",
    /boards\.example\.com/.test(savedRow.textContent) && /used 0×/.test(savedRow.textContent),
    savedRow.textContent
  );
  t("I: 'None yet.' is hidden", O.d.getElementById("recipeEmpty").hidden === true);

  savedRow.querySelector(".snip-del").click();
  await sleep(80);
  t("I: deleting forgets it", (uiStore.jobRecipes.items || []).length === 0);
  t("I: 'None yet.' comes back", O.d.getElementById("recipeEmpty").hidden === false);
  t("I: and it says so", /Forgotten/.test(O.d.getElementById("status").textContent));

  console.log(
    `\n${fail === 0 ? "REMEMBER-WIDGET E2E PASS" : "REMEMBER-WIDGET E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();


