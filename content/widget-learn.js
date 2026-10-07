// widget-learn.js — learn a WIDGET DEFINITION from watching you fill one.
//
// A portal can hold a repeated group we have no SECTIONS entry for: a
// "References" block, an "Emergency contact" pair, a bespoke education widget.
// The extension cannot fill those, so you fill them by hand — and that is
// exactly the moment we can learn from. What we infer is a DEFINITION, never a
// script:
//
//   anchor    = label of the block's most distinctive field (how to find it)
//   confirm   = labels of the other filled fields      (proof it is this group)
//   fields    = slug -> [label text]                   (exactly SECTIONS.fields)
//   values    = slug -> where the value comes from on replay
//   addButton = wording of the add control, so growth stays the engine's job
//
// The definition deliberately mirrors JA.SECTIONS, so replay is the SAME,
// already-guarded section engine (fillSectionBlocks): it refuses to grow or
// mutate anything it cannot verify, which is why a rotten definition is inert
// rather than a click storm.
//
// Nothing is learned unless ALL of these hold — "sure it is a widget":
//   1. the region is a REPEATED group (>=2 sibling blocks of one shape),
//   2. YOU typed into >=2 of its fields (a field we filled is never counted),
//   3. >=2 of those fields have a READABLE label, so the definition can be
//      keyed by label text. A recipe keyed by position or by a React id would
//      rot on the next deploy, so such a widget is REFUSED and reported, never
//      guessed at.
// Candidates live under their own storage key and only become real on a click,
// exactly like an answer-bank entry.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SHARED = window.JOB_AUTOFILL_SHARED || {};
  const KEYS = SHARED.keys || {};
  const PROFILE_KEY = KEYS.profile || "jobProfile";
  const RECIPES_KEY = KEYS.recipes || "jobRecipes";
  const CANDIDATES_KEY = KEYS.widgetCandidates || "widgetCandidates";
  const FLUSH_MS = 600;

  // Controls that are not free-form data.
  const SKIP_INPUT_TYPES = [
    "file", "password", "hidden", "checkbox", "radio", "submit", "button",
    "reset", "image", "range", "color"
  ];

  // Identity numbers, secrets and consent: never remembered as widget data.
  const NEVER_LEARN =
    /(gender|race|ethnicity|veteran|disability|disabled|social security|ssn|passport|national insurance|date of birth|birth date|birthday|password|consent|signature)/;

  // Wording that grows a repeated group.
  const ADD_WORDS = ["add another", "add more", "add", "new"];
  const DOC_POSITION_FOLLOWING = 4;

  let armed = false;
  let profile = {};
  let saved = [];              // saved recipes, for "we already know this widget"
  let flushTimer = null;
  let mine = new Set();        // fields THIS run filled — never user typing
  const regions = new Map();   // container -> { blocks: [], touched: Map(block -> Map(field -> value)) }
  const proposed = new Set();  // fingerprints already written this page load

  const normalize = (text) =>
    JA.normalize ? JA.normalize(text) : String(text || "").toLowerCase();
  const keyOf = (text) =>
    SHARED.keyOf ? SHARED.keyOf(text) : normalize(text);
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const hostOf = () =>
    String((window.location && window.location.host) || "").toLowerCase();

  const fieldsIn = (el) =>
    JA.queryAll(
      'input, select, textarea, [contenteditable="true"], [contenteditable=""]',
      el
    );

  /** The value a field currently holds, contenteditable included. */
  function valueOf(el) {
    if (el.isContentEditable) return el.textContent || "";
    return el.value == null ? "" : String(el.value);
  }

  /** A field we could remember: not a file/password/consent control. */
  function usableField(el) {
    if (!el || !el.tagName) return false;
    const type = (el.type || "").toLowerCase();
    return SKIP_INPUT_TYPES.indexOf(type) === -1;
  }

  /**
   * The label that NAMES a field — never its placeholder or name/id, which are
   * noisy and unstable. An empty result means the field is unreadable, and a
   * widget we cannot label is one we refuse to learn.
   */
  function labelFor(el) {
    const text = JA.labelTextFor ? clean(JA.labelTextFor(el)) : "";
    return text.slice(0, 80);
  }

  /** Shape signature: tag + class names with digits flattened, order-insensitive. */
  function shapeOf(el) {
    const cls = typeof el.className === "string" ? el.className : "";
    const sig = cls
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => name.replace(/\d+/g, "#"))
      .sort()
      .join(".");
    return el.tagName.toLowerCase() + "|" + sig;
  }

  /**
   * The repeated GROUP a field belongs to: walk up until a parent holds >=2
   * siblings of the same shape that each contain fields — that is one block of
   * an add-another widget.
   */
  function groupFor(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 12; depth++) {
      const parent = node.parentElement;
      if (parent) {
        const mine = shapeOf(node);
        const twins = Array.from(parent.children).filter((c) => shapeOf(c) === mine);
        if (twins.length >= 2) {
          const withFields = twins.filter((c) => fieldsIn(c).length > 0);
          if (withFields.length >= 2 && fieldsIn(node).length >= 2) {
            return { block: node, container: parent, blocks: withFields };
          }
        }
      }
      node = parent;
    }
    return null;
  }

  /** The control that grows `container`, if the page has one. */
  function addControlFor(container) {
    const scope = (container && container.parentElement) || container;
    if (!scope) return null;
    const controls = Array.from(
      scope.querySelectorAll('button, [role="button"], a, input[type="button"]')
    );
    for (const el of controls) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const text = normalize(
        el.textContent || el.value || el.getAttribute("aria-label") || ""
      );
      if (!text) continue;
      if (text === "+" || text === "add") return el;
      if (JA.matchesKeywords(text, ADD_WORDS)) return el;
    }
    return null;
  }

  /** The wording of the add control, as replay keywords. */
  function addWordsOf(el) {
    const text = normalize(
      el.textContent || el.value || el.getAttribute("aria-label") || ""
    );
    const words = [];
    for (const word of ADD_WORDS) {
      if (JA.matchesKeywords(text, [word])) words.push(word);
    }
    return words.length ? words : ["add"];
  }

  /** Nearest heading before `container` — the widget's human name. */
  function headingFor(container) {
    const parent = (container && container.parentElement) || document;
    let best = "";
    for (const h of Array.from(
      parent.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')
    )) {
      const text = clean(h.textContent);
      if (!text) continue;
      if (h.compareDocumentPosition(container) & DOC_POSITION_FOLLOWING) best = text;
    }
    return best.slice(0, 60);
  }

  /** Is this widget already handled by a built-in section definition? */
  function coveredByBuiltIn(block) {
    const sections = JA.SECTIONS || {};
    for (const name of Object.keys(sections)) {
      const anchor = (sections[name] && sections[name].anchor) || [];
      if (anchor.length === 0) continue;
      for (const field of fieldsIn(block)) {
        if (JA.matchesKeywords(normalize(JA.getSignal(field)), anchor)) return true;
      }
    }
    return false;
  }

  /**
   * Bind a field to a profile key ONLY when the value you typed IS that stored
   * value. Anything else is kept as a literal. This is what stops a "Reference
   * Name" from being remembered as your own name: it only binds when the two
   * genuinely agree.
   */
  function profileKeyFor(label, value, source) {
    if (!value) return "";
    const bank = source && typeof source === "object" ? source : profile;
    const signal = keyOf(label);
    if (!signal) return "";
    for (const key of Object.keys(JA.KEYWORDS || {})) {
      if (!JA.matchesKeywords(signal, JA.KEYWORDS[key])) continue;
      const stored = bank[key];
      if (typeof stored === "string" && stored.trim() && stored.trim() === value) {
        return key;
      }
    }
    return "";
  }

  /** A stable, sanitizer-safe key for one field (`school`, `referenceName2`). */
  function slugFor(label, used) {
    let base = keyOf(label).replace(/[^a-z0-9]+/g, "");
    if (!/^[a-z]/i.test(base)) base = "f" + base;
    base = base.slice(0, 24) || "field";
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = base + n;
      n++;
    }
    used.add(key);
    return key;
  }

  /** How many of the touched fields hold something. */
  function countFilled(touched) {
    let n = 0;
    for (const [, value] of touched) if (clean(value)) n++;
    return n;
  }

  /**
   * Turn a filled region into a candidate definition, or explain why not.
   * The block that was filled MOST is the model: its filled fields define the
   * widget's field set. Every other block contributes a row keyed by the same
   * labels, so "I filled two references" is remembered as two rows.
   * Returns { candidate } | { skipped: reason } | null.
   */
  function buildCandidate(region) {
    let model = null;
    for (const [block, touched] of region.touched) {
      if (!model || touched.size > model.touched.size) model = { block, touched };
    }
    if (!model) return null;
    if (coveredByBuiltIn(model.block)) return null;

    const canonical = [];
    let unlabelled = 0;
    for (const [el, value] of model.touched) {
      const text = clean(value);
      if (!text) continue;
      const label = labelFor(el);
      if (!label) {
        unlabelled++;
        continue; // unreadable — we cannot key a recipe by it
      }
      if (NEVER_LEARN.test(normalize(label))) return { skipped: label };
      canonical.push({ label, keyword: keyOf(label), text });
    }
    // "Sure it is a widget": one field is a field, two are a widget we can learn.
    if (canonical.length < 2) {
      // A widget we could not label is REFUSED and reported, never guessed at:
      // a definition keyed by position or by a React id would rot immediately.
      if (unlabelled > 0 && canonical.length + unlabelled >= 2) {
        return {
          skipped: headingFor(model.block.parentElement || model.block) ||
            "a widget whose fields have no readable labels"
        };
      }
      return null;
    }

    const used = new Set();
    const fields = {};
    const byKeyword = new Map();
    for (const item of canonical) {
      if (!item.keyword) return null;
      const key = slugFor(item.label, used);
      fields[key] = [item.keyword];
      byKeyword.set(item.keyword, key);
    }
    if (Object.keys(fields).length < 2) return null;

    // One row per block that holds any of those fields.
    const rows = [];
    for (const [, touched] of region.touched) {
      const row = {};
      for (const [el, value] of touched) {
        const text = clean(value);
        if (!text) continue;
        const label = labelFor(el);
        const key = byKeyword.get(keyOf(label));
        if (!key) continue;
        const profileKey = profileKeyFor(label, text);
        row[key] = profileKey
          ? { source: "profile", key: profileKey }
          : { source: "literal", value: text };
      }
      if (Object.keys(row).length > 0) rows.push(row);
    }
    if (rows.length === 0) return null;

    // Anchor on the most distinctive (longest) label; the rest confirm the block.
    let anchor = canonical[0];
    for (const item of canonical) {
      if (item.label.length > anchor.label.length) anchor = item;
    }
    const confirm = [];
    for (const item of canonical) {
      if (item === anchor) continue;
      confirm.push([item.keyword]);
    }

    const block = model.block;
    const add = addControlFor(block.parentElement || block);
    const heading = headingFor(block.parentElement || block);

    return {
      candidate: {
        host: hostOf(),
        name: heading || anchor.label.slice(0, 60),
        fingerprint: canonical
          .map((item) => item.keyword)
          .filter(Boolean)
          .join(" ")
          .slice(0, 120),
        anchor: [anchor.keyword],
        confirm,
        addButton: add ? addWordsOf(add) : [],
        // Learned widgets carry literal/profile values, so nothing is ever
        // reformatted into them — the engine only reformats from/to fields.
        dateFormat: "none",
        fields,
        rows,
        at: Date.now()
      }
    };
  }

  /** A widget we have already been taught for this host+anchor. */
  function alreadyKnown(candidate) {
    const anchor = candidate.anchor[0];
    return saved.some(
      (recipe) =>
        recipe.host === candidate.host && recipe.anchor.indexOf(anchor) !== -1
    );
  }

  async function writeCandidate(candidate) {
    let current = { candidates: [], skipped: [] };
    try {
      const data = await chrome.storage.local.get(CANDIDATES_KEY);
      current = SHARED.sanitizeWidgetCandidates
        ? SHARED.sanitizeWidgetCandidates(data[CANDIDATES_KEY])
        : current;
    } catch (err) {
      return;
    }
    const list = current.candidates || [];
    const duplicate = list.some(
      (c) => c.host === candidate.host && c.fingerprint === candidate.fingerprint
    );
    if (duplicate) return;
    try {
      await chrome.storage.local.set({
        [CANDIDATES_KEY]: {
          candidates: [candidate].concat(list),
          skipped: current.skipped || []
        }
      });
    } catch (err) {
      /* best effort — learning must never disturb the page */
    }
  }

  async function noteSkipped(label) {
    try {
      const data = await chrome.storage.local.get(CANDIDATES_KEY);
      const current = SHARED.sanitizeWidgetCandidates
        ? SHARED.sanitizeWidgetCandidates(data[CANDIDATES_KEY])
        : { candidates: [], skipped: [] };
      const skipped = current.skipped || [];
      if (skipped.indexOf(label) !== -1) return;
      skipped.push(label);
      await chrome.storage.local.set({
        [CANDIDATES_KEY]: {
          candidates: current.candidates || [],
          skipped: skipped.slice(-10)
        }
      });
    } catch (err) {
      /* best effort */
    }
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_MS);
  }

  /** One widget offer at a time, and never the same one twice in a page load. */
  async function flush() {
    flushTimer = null;
    let best = null;
    let skippedLabel = "";

    for (const [, region] of regions) {
      let enough = false;
      for (const [, touched] of region.touched) {
        if (countFilled(touched) >= 2) {
          enough = true;
          break;
        }
      }
      if (!enough) continue;

      const built = buildCandidate(region);
      if (built && built.skipped) {
        skippedLabel = built.skipped;
        break;
      }
      if (built && built.candidate) {
        best = built.candidate;
        break;
      }
    }

    if (skippedLabel) {
      await noteSkipped(skippedLabel);
      return;
    }
    if (!best) return;
    if (proposed.has(best.fingerprint) || alreadyKnown(best)) return;
    proposed.add(best.fingerprint);
    await writeCandidate(best);
  }

  /** Watch the fields this fill left, and learn any widget you fill by hand. */
  JA.armWidgetLearning = function (filledByUs) {
    if (armed) return; // one watcher per frame per page load
    armed = true;

    // A field the fill itself wrote is not "something you typed", so it can
    // never be part of a learned widget.
    mine = filledByUs instanceof Set ? filledByUs : new Set();

    document.addEventListener("change", onCommitted, true);
    document.addEventListener("blur", onCommitted, true);

    // Load what we already know, so a widget is never offered twice, and load
    // the profile so a value that IS a profile value binds to it.
    try {
      const reading = chrome.storage.local.get([PROFILE_KEY, RECIPES_KEY]);
      if (reading && typeof reading.then === "function") {
        reading
          .then((data) => {
            profile = (data && data[PROFILE_KEY]) || {};
            saved =
              data && data[RECIPES_KEY] !== undefined && SHARED.sanitizeRecipes
                ? SHARED.sanitizeRecipes(data[RECIPES_KEY]).items
                : [];
          })
          .catch(() => {});
      }
    } catch (err) {
      /* learning is best-effort by design */
    }
  };

  function onCommitted(event) {
    const el = event && event.target;
    if (!usableField(el)) return;
    if (mine.has(el)) return; // the fill wrote this, not you
    const group = groupFor(el);
    if (!group) return;

    let region = regions.get(group.container);
    if (!region) {
      region = { blocks: group.blocks, touched: new Map() };
      regions.set(group.container, region);
    }
    region.blocks = group.blocks;

    let blockMap = region.touched.get(group.block);
    if (!blockMap) {
      blockMap = new Map();
      region.touched.set(group.block, blockMap);
    }
    blockMap.set(el, valueOf(el));
    scheduleFlush();
  }

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

    const host = hostOf();
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

  // Exposed so the suites can drive the inference directly.
  JA.widgetLearnInternals = {
    shapeOf,
    groupFor,
    addControlFor,
    headingFor,
    labelFor,
    profileKeyFor,
    buildCandidate,
    entryFor
  };

  // Exposed so a test can await the debounced write instead of guessing.
  JA.widgetLearningPending = () => flushTimer !== null;
})();



