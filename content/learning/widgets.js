// widgets.js — learn a WIDGET DEFINITION from watching you fill one.
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
// Replaying that definition is NOT here — it is sections/recipe-replay.js, so
// capture and replay can be read (and reasoned about) separately.
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
  const S = JA.widgetShape;   // shape reading lives in widget-shape.js
  const SHARED = window.JOB_AUTOFILL_SHARED || {};
  const KEYS = SHARED.keys || {};
  const PROFILE_KEY = KEYS.profile || "jobProfile";
  const RECIPES_KEY = KEYS.recipes || "jobRecipes";
  const CANDIDATES_KEY = KEYS.widgetCandidates || "widgetCandidates";
  const FLUSH_MS = 600;
  let cleared = false;
  let generation = 0;

  // A typed value longer than this is a per-application ANSWER, not widget data.
  // A definition is scoped to the site's host, and a board like Greenhouse or
  // Lever shares ONE host across every company, so a long answer saved here
  // would be pasted verbatim into the next company's form. Those belong in the
  // answer bank, which asks before it reuses them.
  const MAX_LITERAL = 120;

  // Controls that are not free-form data.
  const SKIP_INPUT_TYPES = [
    "file", "password", "hidden", "checkbox", "radio", "submit", "button",
    "reset", "image", "range", "color"
  ];

  // Identity numbers, secrets and consent: never remembered as widget data.
  const NEVER_LEARN =
    /(gender|race|ethnicity|veteran|disability|disabled|social security|ssn|passport|national insurance|date of birth|birth date|birthday|password|consent|signature)/;


  let profile = {};
  let saved = [];              // saved recipes, for "we already know this widget"
  let flushTimer = null;
  let mine = new Set();        // fields THIS run filled — never user typing
  const regions = new Map();   // container -> { blocks: [], touched: Map(block -> Map(field -> value)) }
  const proposed = new Set();  // fingerprints already written this page load

  const hostOf = () =>
    JA.pageHost
      ? JA.pageHost()
      : String((window.location && window.location.host) || "").toLowerCase();


  /**
   * A set of "fields we wrote", however the caller built it. Duck-typed rather
   * than `instanceof Set`: the fill hands us a Set from the page's realm, but a
   * caller in another realm (an isolated world, or a test harness) would build
   * one that `instanceof` does not recognise, and we would forget every field
   * the fill wrote — exactly the mistake this feature must never make.
   */
  function asSet(value) {
    if (
      value &&
      typeof value.has === "function" &&
      typeof value.forEach === "function"
    ) {
      return value;
    }
    try {
      return new Set(value || []);
    } catch (err) {
      return new Set();
    }
  }

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
   * Bind a field to a profile key ONLY when the value you typed IS that stored
   * value. Anything else is kept as a literal. This is what stops a "Reference
   * Name" from being remembered as your own name: it only binds when the two
   * genuinely agree.
   */
  function profileKeyFor(label, value, source) {
    if (!value) return "";
    const bank = source && typeof source === "object" ? source : profile;
    const signal = S.keyOf(label);
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
    let base = S.keyOf(label).replace(/[^a-z0-9]+/g, "");
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
    for (const [, value] of touched) if (S.clean(value)) n++;
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
    if (S.coveredByBuiltIn(model.block)) return null;

    const canonical = [];
    let unlabelled = 0;
    for (const [el, value] of model.touched) {
      const text = S.clean(value);
      if (!text) continue;
      const label = S.labelFor(el);
      if (!label) {
        unlabelled++;
        continue; // unreadable — we cannot key a recipe by it
      }
      if (NEVER_LEARN.test(S.normalize(label))) return { skipped: label };
      // Long free text is an answer for THIS application, not a widget value.
      if (!profileKeyFor(label, text) && text.length > MAX_LITERAL) {
        return { skipped: label };
      }
      canonical.push({ label, keyword: S.keyOf(label), text });
    }
    // "Sure it is a widget": one field is a field, two are a widget we can learn.
    if (canonical.length < 2) {
      // A widget we could not label is REFUSED and reported, never guessed at:
      // a definition keyed by position or by a React id would rot immediately.
      if (unlabelled > 0 && canonical.length + unlabelled >= 2) {
        return {
          skipped: S.headingFor(model.block.parentElement || model.block) ||
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
        const text = S.clean(value);
        if (!text) continue;
        const label = S.labelFor(el);
        const key = byKeyword.get(S.keyOf(label));
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
    const add = S.addControlFor(block.parentElement || block);
    const heading = S.headingFor(block.parentElement || block);

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
        addButton: add ? S.addWordsOf(add) : [],
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
    const epoch = generation;
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
    if (cleared || epoch !== generation) return;
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
    const epoch = generation;
    try {
      const data = await chrome.storage.local.get(CANDIDATES_KEY);
      if (cleared || epoch !== generation) return;
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
    if (cleared) return;
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

  /**
   * Watch the fields this fill left, and learn any widget you fill by hand.
   *
   * There is ONE watcher per PAGE, never one per fill. A Fill re-injects these
   * scripts, so a second copy would otherwise stack a second pair of listeners
   * on top of the first — and the first copy's `mine` set is from the PREVIOUS
   * fill, so it would read the new fill's own writes as your typing, and its
   * `saved` list would be stale enough to re-offer a widget you just saved.
   * The first copy to arm keeps the listeners; every later fill only refreshes
   * what that single watcher knows.
   */
  JA.armWidgetLearning = function (filledByUs) {
    const filled = asSet(filledByUs);
    const watch = (JA.__widgetWatch = JA.__widgetWatch || {});
    if (watch.update) {
      watch.update(filled);
      return;
    }

    // A field the fill itself wrote is not "something you typed", so it can
    // never be part of a learned widget.
    mine = filled;

    document.addEventListener("change", onCommitted, true);
    document.addEventListener("blur", onCommitted, true);
    watch.update = (nextMine) => {
      mine = asSet(nextMine);
      loadKnown(); // a widget saved since the last fill must be recognised
    };
    if (chrome.storage.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[PROFILE_KEY] || changes[PROFILE_KEY].newValue !== undefined) return;
      cleared = true;
      generation++;
      clearTimeout(flushTimer);
      flushTimer = null;
      regions.clear(); proposed.clear();
      profile = {}; saved = [];
    });
    loadKnown();
  };

  /**
   * Load what we already know, so a widget is never offered twice, and load the
   * profile so a value that IS a profile value binds to it. Re-run by the single
   * watcher on every fill so `saved` can never go stale.
   */
  function loadKnown() {
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
  }

  function onCommitted(event) {
    if (cleared) return;
    const el = event && event.target;
    if (!usableField(el)) return;
    if (mine.has(el)) return; // the fill wrote this, not you
    const group = S.groupFor(el);
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

  // Exposed so the suites can drive the inference directly.
  JA.widgetLearnInternals = {
    shapeOf: S.shapeOf,
    groupFor: S.groupFor,
    addControlFor: S.addControlFor,
    headingFor: S.headingFor,
    labelFor: S.labelFor,
    profileKeyFor,
    buildCandidate,
    entryFor: (row, source) => JA.recipeInternals.entryFor(row, source)
  };

  // Exposed so a test can await the debounced write instead of guessing.
  JA.widgetLearningPending = () => flushTimer !== null;
})();
