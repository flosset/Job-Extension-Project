// recipe-replay.js — replay a widget definition the user accepted.
//
// A recipe is DATA, replayed by the same already-guarded section engine the
// built-in Work Experience / Education definitions use (fillSectionBlocks), so
// a stale definition does nothing at all rather than clicking at random. A
// recipe is consulted ONLY for its own host, and only when its anchors really
// match a block on this page.
//
// Capturing a definition is the other half, in learning/widgets.js.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SHARED = window.JOB_AUTOFILL_SHARED || {};
  const RECIPES_KEY = (SHARED.keys && SHARED.keys.recipes) || "jobRecipes";

  /** Build the entry the engine should write, from one row's value sources. */
  function entryFor(row, source) {
    const entry = {};
    const cells = row && typeof row === "object" ? row : {};
    for (const key of Object.keys(cells)) {
      const src = cells[key] || {};
      if (src.source === "profile") {
        const value = source[src.key];
        if (typeof value === "string" && value.trim()) entry[key] = value;
      } else if (typeof src.value === "string" && src.value) {
        entry[key] = src.value;
      }
    }
    return entry;
  }

  /** A stable identity for a recipe: its host plus its anchor. */
  function recipeKey(recipe) {
    const anchor = (recipe.anchor || [])[0] || "";
    return recipe.host + "|" + anchor;
  }

  /** Record that these recipes actually filled something, for the profile UI. */
  async function bumpUsage(keys) {
    try {
      const data = await chrome.storage.local.get(RECIPES_KEY);
      const state = SHARED.sanitizeRecipes
        ? SHARED.sanitizeRecipes(data[RECIPES_KEY])
        : { items: [] };
      let changed = false;
      for (const recipe of state.items) {
        if (keys.indexOf(recipeKey(recipe)) === -1) continue;
        recipe.uses = (recipe.uses || 0) + 1;
        recipe.lastUsedAt = Date.now();
        changed = true;
      }
      if (changed) await chrome.storage.local.set({ [RECIPES_KEY]: state });
    } catch (err) {
      /* usage stats are a nicety, never a requirement */
    }
  }

  /**
   * Apply every remembered widget that matches this page.
   *
   * A recipe is consulted ONLY for its own host, and only when its anchors
   * really match a block here — so a stale definition does nothing at all
   * rather than clicking at random. Returns { filled, applied }.
   */
  JA.fillLearnedWidgets = async function (sourceProfile, used) {
    const source =
      sourceProfile && typeof sourceProfile === "object" ? sourceProfile : {};
    if (!JA.fillSectionBlocks) return { filled: 0, applied: [] };

    let recipes = [];
    try {
      const data = await chrome.storage.local.get(RECIPES_KEY);
      recipes = SHARED.sanitizeRecipes
        ? SHARED.sanitizeRecipes(data[RECIPES_KEY]).items
        : [];
    } catch (err) {
      return { filled: 0, applied: [] };
    }
    if (recipes.length === 0) return { filled: 0, applied: [] };

    const host = JA.pageHost();
    let filled = 0;
    const applied = [];

    for (const recipe of recipes) {
      if (recipe.host !== host) continue;
      const section = {
        anchor: recipe.anchor,
        confirm: recipe.confirm,
        fields: recipe.fields,
        addButton: recipe.addButton,
        dateFormat: recipe.dateFormat
      };
      // Not on this page (or no longer matching): do nothing, say nothing.
      if (JA.sectionBlocks(section).length === 0) continue;

      const entries = [];
      for (const row of recipe.rows || []) {
        const entry = entryFor(row, source);
        if (Object.keys(entry).length > 0) entries.push(entry);
      }
      if (entries.length === 0) continue;

      try {
        const part = await JA.fillSectionBlocks(section, entries, used);
        if (part && part.filled > 0) {
          filled += part.filled;
          // Keyed by host+anchor rather than id: a recipe read back from
          // storage is re-assigned an id, so an id would never match twice.
          applied.push(recipeKey(recipe));
        }
      } catch (err) {
        /* one stubborn widget must not abort the rest */
      }
    }

    if (applied.length) bumpUsage(applied);
    return { filled, applied };
  };

  // The row -> values resolver, shared with learning/widgets.js so the suite's
  // handle to it (widgetLearnInternals.entryFor) keeps working.
  JA.recipeInternals = { entryFor };
})();
