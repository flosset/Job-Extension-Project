// widgets.js — the review step for "remember this widget", plus the saved list.
//
// The content script only ever stores CANDIDATES (under their own key); a saved
// definition — what the fill pipeline actually replays — is written HERE, on an
// explicit click, exactly like a hand-typed answer-bank entry. So a candidate
// can never fill a live form, however sure the extension was about it.
//
// The saved list lives on the profile page, where a stale one can be deleted and
// where it shows when each was last actually used.

"use strict";

/** What the content script noticed and the user has not accepted yet. */
let widgetCandidates = { candidates: [], skipped: [] };
/** The saved widgets — the definitions the fill pipeline replays. */
let recipeState = { items: [] };

/** A stable identity for a candidate/recipe: host plus its anchor. */
function widgetKey(widget) {
  const anchor = (widget.anchor || [])[0] || "";
  return (widget.host || "") + "|" + anchor;
}

function widgetCoversAnswer(candidate) {
  if (!candidate.site) return false;
  const question = JOB_AUTOFILL_SHARED.keyOf(candidate.question);
  const section = $("widgetSection");
  const pending = (section && section.widgetList) || [];
  // shortcut: only exact labels and literal values qualify; profile bindings need separate comparison.
  return pending.concat(recipeState.items).some((widget) =>
    !widget.taught && widget.host === candidate.site && Object.keys(widget.fields).some((key) =>
      widget.fields[key].some((label) => JOB_AUTOFILL_SHARED.keyOf(label) === question) &&
      widget.rows.length > 0 && widget.rows.every((row) =>
        row[key] && row[key].source === "literal" && row[key].value === candidate.value
      )
    )
  );
}

/** The host of the tab the popup is open on ("" on the options page). */
async function pageHost() {
  try {
    if (!chrome.tabs || !chrome.tabs.query) return "";
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs && tabs[0] && tabs[0].url;
    return url ? new URL(url).host.toLowerCase() : "";
  } catch (err) {
    return "";
  }
}

const isOptionsPage = () =>
  !!(document.body && document.body.dataset.page === "options");

/** Read both lists, then render whatever this page shows. */
async function loadWidgets() {
  const epoch = editEpoch;
  try {
    const data = await chrome.storage.local.get([
      RECIPES_KEY,
      WIDGET_CANDIDATES_KEY
    ]);
    if (epoch !== editEpoch || deletingData) return;
    recipeState = JOB_AUTOFILL_SHARED.sanitizeRecipes(data[RECIPES_KEY]);
    widgetCandidates = JOB_AUTOFILL_SHARED.sanitizeWidgetCandidates(
      data[WIDGET_CANDIDATES_KEY]
    );
  } catch (err) {
    recipeState = { items: [] };
    widgetCandidates = { candidates: [], skipped: [] };
  }
  await renderWidgetOffer();
  renderRecipes();
}

async function storeCandidates() {
  try {
    await chrome.storage.local.set({ [WIDGET_CANDIDATES_KEY]: widgetCandidates });
  } catch (err) {
    /* nothing else we can do — the saved list is untouched either way */
  }
}

async function storeRecipes() {
  try {
    await chrome.storage.local.set({ [RECIPES_KEY]: recipeState });
    return true;
  } catch (err) {
    setStatus("Could not save widgets. Your changes have not been saved; try again.", "warn");
    return false;
  }
}

/** "References · 2 blocks · 3 fields" — what the user is being asked about. */
function describeWidget(widget) {
  const fields = Object.keys(widget.fields || {}).length;
  const rows = (widget.rows || []).length;
  return [
    widget.name || "Widget",
    rows + (rows === 1 ? " block" : " blocks"),
    fields + (fields === 1 ? " field" : " fields")
  ].join(" · ");
}

/** Which pending widgets this page should show. */
async function shownCandidates() {
  const list = widgetCandidates.candidates || [];
  if (isOptionsPage()) return list; // the profile page reviews everything
  const host = await pageHost();
  if (!host) return list; // no tab host to go on — better to show than to hide
  return list.filter((candidate) => candidate.host === host);
}

/** The "Remember this widget?" offer — popup, and the profile page. */
async function renderWidgetOffer() {
  const section = $("widgetSection");
  if (!section) return;
  const list = await shownCandidates();
  section.hidden = list.length === 0;
  section.widgetList = list;

  const rows = $("widgetRows");
  if (rows) {
    rows.innerHTML = "";
    for (const candidate of list) {
      const row = document.createElement("div");
      row.className = "widget-row";
      const name = document.createElement("div");
      name.className = "widget-name";
      name.textContent = describeWidget(candidate);
      const where = document.createElement("div");
      where.className = "widget-where";
      where.textContent = candidate.host;
      row.appendChild(name);
      row.appendChild(where);
      appendWidgetOverride(row, candidate);
      rows.appendChild(row);
    }
  }

  const note = $("widgetNote");
  if (note) {
    const skipped = (widgetCandidates.skipped || []).length;
    note.textContent =
      "A widget you filled by hand can be remembered, so I can fill it for you " +
      "next time. Nothing is saved until you click Save." +
      (skipped
        ? ` ${skipped} widget${skipped === 1 ? "" : "s"} could not be learned ` +
          "(its fields need readable labels, and a long free-text answer belongs " +
          "in the answer bank instead)."
        : "");
  }
}

/** Accept every visible candidate: it becomes a saved definition. */
async function saveAllWidgets() {
  const section = $("widgetSection");
  const list = (section && section.widgetList) || [];
  if (list.length === 0) return;

  let added = 0;
  try {
    await JOB_AUTOFILL_SHARED.withStorageLock(async () => {
      const data = await chrome.storage.local.get([RECIPES_KEY, WIDGET_CANDIDATES_KEY]);
      const recipes = JOB_AUTOFILL_SHARED.sanitizeRecipes(data[RECIPES_KEY]);
      const candidates = JOB_AUTOFILL_SHARED.sanitizeWidgetCandidates(data[WIDGET_CANDIDATES_KEY]);
      const items = recipes.items.slice();
      for (const candidate of list) {
        if (items.some(recipe => widgetKey(recipe) === widgetKey(candidate))) continue;
        if (items.length >= JOB_AUTOFILL_SHARED.maxRecipes) throw new Error("limit");
        items.unshift({ ...candidate, id: JOB_AUTOFILL_SHARED.newId(), createdAt: Date.now() });
        added++;
      }
      const saved = JOB_AUTOFILL_SHARED.sanitizeRecipes({ items });
      const keys = list.map(widgetKey);
      const remaining = { candidates: candidates.candidates.filter(candidate => !keys.includes(widgetKey(candidate))), skipped: candidates.skipped };
      await chrome.storage.local.set({ [RECIPES_KEY]: saved, [WIDGET_CANDIDATES_KEY]: remaining });
      recipeState = saved;
      widgetCandidates = remaining;
    });
  } catch (err) {
    setStatus(err.message === "limit"
      ? "Saved widget limit reached. Forget an old widget first; your suggestions are still pending."
      : "Could not save widgets. Your suggestions are still pending; try again.", "warn");
    return;
  }
  await renderWidgetOffer();
  renderRecipes();
  setStatus(
    added > 0
      ? `Saved ${added} widget${added === 1 ? "" : "s"} — I will fill ${
          added === 1 ? "it" : "them"
        } next time.`
      : "Already saved.",
    added > 0 ? "ok" : "warn"
  );
}

/** Decline every visible candidate. Nothing is written but the dismissal. */
async function dismissAllWidgets() {
  const section = $("widgetSection");
  const list = (section && section.widgetList) || [];
  if (list.length === 0) return;

  const keys = list.map(widgetKey);
  widgetCandidates = {
    candidates: (widgetCandidates.candidates || []).filter(
      (candidate) => keys.indexOf(widgetKey(candidate)) === -1
    ),
    skipped: widgetCandidates.skipped || []
  };
  await storeCandidates();
  await renderWidgetOffer();
  renderLearned();
  setStatus("Not saved.", "");
}

/** The saved list, on the profile page: what it is, when it was last used. */
function appendWidgetOverride(container, recipe) {
  const key = JOB_AUTOFILL_SHARED.profileKeyForWidget(recipe, storedProfile);
  if (!key) return;
  const note = document.createElement("div");
  note.className = "widget-override";
  const label = key === "workAuthorized" ? "work authorization" : "sponsorship";
  note.textContent = "Overrides your profile's " + label +
    " answer. This widget's saved value takes priority when filling.";
  container.appendChild(note);
}

function renderRecipes() {
  renderLearned();
  const container = $("recipeRows");
  if (!container) return;
  container.innerHTML = "";

  const items = recipeState.items || [];
  const empty = $("recipeEmpty");
  if (empty) empty.hidden = items.length > 0;
  if (items.length === 0) return;

  for (const recipe of items) {
    const row = document.createElement("div");
    row.className = "app-row";
    row.title = `Remembered on ${recipe.host}`;

    const main = document.createElement("div");
    main.className = "app-main";

    const name = document.createElement("div");
    name.className = "app-name";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-company";
    input.value = recipe.name;
    input.title = "What to call this widget — edit freely";
    input.addEventListener("change", () => renameRecipe(recipe.id, input.value));
    name.appendChild(input);
    main.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "app-meta";
    const when =
      typeof formatWhen === "function"
        ? formatWhen(recipe.lastUsedAt)
        : new Date(recipe.lastUsedAt).toLocaleDateString();
    meta.textContent =
      recipe.host +
      ` · ${Object.keys(recipe.fields || {}).length} fields` +
      ` · used ${recipe.uses || 0}×` +
      (recipe.lastUsedAt ? ` · last ${when}` : " · not used yet");
    if (recipe.taught) meta.textContent += recipe.taught.scope === "page"
      ? " · taught for " + recipe.taught.path
      : " · taught for this site";
    main.appendChild(meta);

    // The VALUES this widget writes, editable in place.
    //
    // A widget stores literal values, so a widget captured last year keeps
    // answering with last year's answer — "authorized to work: Yes" survives a
    // change in status, and a referee's email goes stale. Before this, the only
    // recourse was to forget the whole widget and answer the form by hand again,
    // which is a bad trade for changing one word. Free text rather than a
    // dropdown: it works for every value (an answer, an email, a phone number),
    // with no need to know which field is boolean.
    const values = document.createElement("div");
    values.className = "app-meta widget-values";
    const row0 = (recipe.rows || [])[0] || {};
    for (const key of Object.keys(recipe.fields || {})) {
      const cell = row0[key];
      const line = document.createElement("label");
      line.className = "widget-value";

      const caption = document.createElement("span");
      // The field's own keywords are the best human label we stored.
      caption.textContent = (recipe.taught ? recipe.taught.controls[key].label : (recipe.fields[key] || []).join(" / ")) + " = ";
      line.appendChild(caption);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "app-company";
      // A field with NO value in row 0 is one this widget does not write yet;
      // show it as empty rather than pretending it has one.
      input.value = cell && cell.source === "literal" ? String(cell.value || "") : "";
      input.placeholder = cell && cell.source === "profile" ? `profile: ${cell.key}` : "";
      input.disabled = !!(cell && cell.source === "profile");
      input.title = input.disabled
        ? "This value comes from your profile, so it is read fresh each time."
        : "What this widget answers with — edit freely";
      input.addEventListener("change", () =>
        editRecipeValue(recipe.id, key, input.value)
      );
      line.appendChild(input);
      values.appendChild(line);
    }
    if (values.childNodes.length > 0) main.appendChild(values);

    // Say it out loud when the profile also answers this question.
    //
    // A widget always WINS: it replays first and claims its fields, so the
    // profile pass never touches it. That is deliberate (your taught widget is
    // more specific than a generic label match) but it is silent, and it means
    // the same answer now lives in two places. Without this note the user edits
    // their profile, sees the widget keep answering the old value, and has no
    // way to know why.
    appendWidgetOverride(main, recipe);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "snip-del";
    remove.title = "Forget this widget (use this when it has gone stale)";
    remove.textContent = "×";
    remove.addEventListener("click", () => deleteRecipe(recipe.id));

    row.appendChild(main);
    row.appendChild(remove);
    container.appendChild(row);
  }
}

/**
 * Change one literal value a saved widget writes.
 *
 * Rewrites row 0's cell for that field, and ONLY that cell: the row structure,
 * the anchors and the other fields are untouched, so a correction cannot turn a
 * working widget into a differently-shaped one. A field currently bound to the
 * profile is left alone (its input is disabled) — that value is read fresh on
 * every run, so editing it here would be a lie.
 */
async function editRecipeValue(id, fieldKey, value) {
  const clean = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!clean) return; // an empty value is a deletion, which we do not do here

  recipeState = JOB_AUTOFILL_SHARED.sanitizeRecipes({
    items: recipeState.items.map((recipe) => {
      if (recipe.id !== id) return recipe;
      const rows = (recipe.rows || []).slice();
      const row0 = Object.assign({}, rows[0] || {});
      const cell = row0[fieldKey];
      if (cell && cell.source === "profile") return recipe; // not ours to edit
      row0[fieldKey] = { source: "literal", value: clean };
      rows[0] = row0;
      return Object.assign({}, recipe, { rows });
    })
  });
  if (!(await storeRecipes())) return;
  renderRecipes();
  setStatus("Widget updated.", "ok");
}

/** Rename a saved widget. */
async function renameRecipe(id, name) {
  const clean = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
  recipeState = JOB_AUTOFILL_SHARED.sanitizeRecipes({
    items: recipeState.items.map((recipe) =>
      recipe.id === id
        ? Object.assign({}, recipe, { name: clean || "Widget" })
        : recipe
    )
  });
  if (!(await storeRecipes())) return;
  renderRecipes();
}

/** Forget a saved widget — the escape hatch for one that has gone stale. */
async function deleteRecipe(id) {
  recipeState = JOB_AUTOFILL_SHARED.sanitizeRecipes({
    items: recipeState.items.filter((recipe) => recipe.id !== id)
  });
  if (!(await storeRecipes())) return;
  renderRecipes();
  setStatus("Forgotten — it will not be filled again.", "");
}

