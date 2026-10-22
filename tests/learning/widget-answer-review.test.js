"use strict";
const assert = require("assert");
const { JSDOM } = require("jsdom");
const { POPUP_JS } = require("../_popup-source");

const answer = { question: "Reference email", value: "ref@example.com", site: "boards.example.com", at: 1 };
const other = { question: "Why this role?", value: "An interesting role", site: answer.site, at: 2 };
const widget = {
  host: answer.site, name: "References", anchor: ["reference email"],
  fields: { email: ["reference email"] },
  rows: [{ email: { source: "literal", value: answer.value } }]
};

async function open(saved = false, widgetsFirst = false) {
  const dom = new JSDOM(`<!doctype html><body data-page="options">
    <p id="status"></p>
    <div id="learnedSection"><p id="learnedNote"></p><div id="learnedRows"></div></div>
    <div id="widgetSection"><p id="widgetNote"></p><div id="widgetRows"></div></div>
    <div id="recipeRows"></div><p id="recipeEmpty"></p>
  </body>`, { runScripts: "dangerously", url: "https://example.com/" });
  const w = dom.window;
  await new Promise((resolve) => w.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  const store = JSON.parse(JSON.stringify({
    jobProfile: {}, learnedAnswers: { candidates: [answer, other], skipped: [] },
    widgetCandidates: { candidates: saved ? [] : [widget], skipped: [] },
    jobRecipes: { items: saved ? [{ ...widget, id: "saved" }] : [] }
  }));
  w.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]])),
    set: async (data) => Object.assign(store, data)
  } } };
  // Exercise the real review functions without bootstrapping unrelated panels.
  w.eval(POPUP_JS + `\nwindow.review = {
    loadLearned, loadWidgets, saveAllLearned, dismissAllLearned,
    saveAllWidgets, dismissAllWidgets, deleteRecipe,
    widgetCoversAnswer, editRecipeValue
  };`);
  if (widgetsFirst) {
    await w.review.loadWidgets();
    await w.review.loadLearned();
  } else {
    await w.review.loadLearned();
    await w.review.loadWidgets();
  }
  return { w, store, api: w.review, rows: () => [...w.document.querySelectorAll(".learn-row .snip-key")].map((el) => el.value) };
}

(async () => {
  for (const widgetsFirst of [false, true]) {
    const p = await open(false, widgetsFirst);
    try {
      assert.deepStrictEqual(p.rows(), [other.question], "exact duplicate is deferred in either load order");
      assert(p.w.document.getElementById("learnedNote").textContent.includes("1 answer suggestion is"));
      assert.strictEqual(p.store.learnedAnswers.candidates.length, 2, "rendering never deletes pending data");
      await p.api.saveAllLearned();
      assert.deepStrictEqual(Array.from(p.store.jobProfile.customSnippets, (entry) => entry.key), [other.question]);
      assert.strictEqual(p.store.learnedAnswers.candidates.length, 1, "Save all preserves deferred answers");
      await p.api.dismissAllWidgets();
      assert.deepStrictEqual(p.rows(), [answer.question], "dismissing the widget restores its answer suggestion");
    } finally { p.w.close(); }
  }

  const p = await open();
  try {
    p.w.document.body.dataset.page = "popup";
    p.w.chrome.tabs = { query: async () => [{ url: "https://elsewhere.example.com/apply" }] };
    await p.api.loadWidgets();
    assert(p.rows().includes(answer.question), "an offer hidden on another host cannot defer an answer");
    p.w.document.body.dataset.page = "options";
    await p.api.loadWidgets();
    await p.api.dismissAllLearned();
    assert.strictEqual(p.store.learnedAnswers.candidates.length, 1, "Dismiss all preserves deferred answers");
    await p.api.saveAllWidgets();
    assert.deepStrictEqual(p.rows(), [], "saving the widget keeps its duplicate deferred");
    assert.strictEqual(p.store.learnedAnswers.candidates.length, 1, "accepting the widget preserves fallback data");
    await p.api.deleteRecipe(p.store.jobRecipes.items[0].id);
    assert.deepStrictEqual(p.rows(), [answer.question], "forgetting the widget restores the fallback");
  } finally { p.w.close(); }

  const s = await open(true);
  try {
    assert.deepStrictEqual(s.rows(), [other.question], "a previously saved literal widget also covers its answer");
    for (const candidate of [
      { ...answer, site: "elsewhere.example.com" },
      { ...answer, site: "" },
      { ...answer, value: "different@example.com" },
      { ...answer, value: "REF@example.com" },
      { ...answer, question: "Email" }
    ]) assert.strictEqual(s.api.widgetCoversAnswer(candidate), false, "partial or conflicting matches remain visible");

    s.store.jobRecipes.items[0].rows.push({ email: { source: "literal", value: "second@example.com" } });
    await s.api.loadWidgets();
    assert(s.rows().includes(answer.question), "different values across rows do not establish coverage");
    s.store.jobRecipes.items[0].rows = [{ email: { source: "profile", key: "email" } }];
    await s.api.loadWidgets();
    assert(s.rows().includes(answer.question), "profile bindings do not hide literal answer suggestions");
    s.store.jobRecipes.items[0].rows = widget.rows;
    await s.api.loadWidgets();
    await s.api.editRecipeValue("saved", "email", "updated@example.com");
    assert(s.rows().includes(answer.question), "editing a saved value recalculates coverage");
  } finally { s.w.close(); }
  console.log("PASS widget and answer review coordination");
})().catch((error) => { console.error(error); process.exitCode = 1; });
