// field-matcher.js — choosing WHICH field on the page answers a profile key:
// attribute selectors first, then label keywords, skipping anything already
// filled or claimed by an earlier pass. Also the generic find-by-keywords used
// by repeatable sections, resume attach and the cover letter.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /**
   * First element under `root` whose label/signal matches the keywords.
   * `opts.used` (a Set) is honoured: a control another pass already filled is
   * never handed out again, so two passes that both recognise a field can never
   * both write it. Without this the section engine would re-fill controls the
   * page-wide passes had already answered.
   */
  JA.findFieldByKeywords = function (root, keywords, opts) {
    opts = opts || {};
    if (!keywords || !keywords.length) return null;
    const scope = root || document;
    const els = Array.from(
      scope.querySelectorAll(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      )
    );
    for (const el of els) {
      if (opts.used && opts.used.has(el)) continue;
      if (opts.tagName && el.tagName !== opts.tagName) continue;
      if (opts.type && (el.type || "").toLowerCase() !== opts.type) continue;
      if (!opts.type && JA.isComboboxInput && JA.isComboboxInput(el)) continue;
      if (JA.matchesKeywords(JA.normalize(JA.getSignal(el)), keywords)) return el;
    }
    return null;
  };

  /** All elements matched by a list of CSS attribute selectors. */
  function attributeMatches(selectorList) {
    const out = [];
    for (const selector of selectorList || []) {
      // JA.queryAll, not document.querySelectorAll: a field inside an open
      // shadow root is invisible to the latter.
      for (const el of JA.queryAll(selector)) out.push(el);
    }
    return out;
  }

  /** Pool elements whose label/aria text matches a keyword list. */
  function keywordMatches(pool, keywords, tagName) {
    if (!keywords) return [];
    return pool.filter((el) => {
      if (tagName && el.tagName !== tagName) return false;
      return JA.matchesKeywords(JA.normalize(JA.getSignal(el)), keywords);
    });
  }

  /**
   * First candidate that is accepted, unused, fillable and still empty.
   * Skips non-matching tags, used elements and already-filled fields, so a
   * filled first match never blocks a later empty one.
   */
  function pickElement(candidates, used, accept) {
    const seen = new Set();
    for (const el of candidates) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (used.has(el)) continue;
      if (accept && !accept(el)) continue;
      if (!JA.isFillable(el)) continue;
      if (JA.isFilled(el)) continue;
      return el;
    }
    return null;
  }

  /** Pick the best text field (input/textarea/contenteditable) for a key. */
  function pickField(key, pool, used) {
    const candidates = attributeMatches(JA.ATTRIBUTE_SELECTORS[key]).concat(
      keywordMatches(pool, JA.KEYWORDS[key], null)
    );
    return pickElement(candidates, used, (el) => {
      if (el.tagName === "SELECT" || JA.isComboboxInput(el)) return false;
      // A phone EXTENSION is not a phone number: it must never receive one.
      // The literal fallback keeps a fill working even if field-map.js were
      // somehow absent — a missing helper must never abort the whole run.
      if (
        key === "phone" &&
        JA.matchesKeywords(
          JA.normalize(JA.getSignal(el)),
          JA.PHONE_EXTENSION_KEYWORDS || ["extension", "ext", "extn"]
        )
      ) {
        return false;
      }
      return true;
    });
  }

  /** Pick the best <select> for a self-identification key. */
  function pickSelect(key, pool, used) {
    const candidates = attributeMatches(JA.SELECT_SELECTORS[key]).concat(
      keywordMatches(pool, JA.KEYWORDS[key], "SELECT")
    );
    return pickElement(candidates, used, (el) => el.tagName === "SELECT");
  }

  /** Pick the best <select> for arbitrary keywords (answer-bank entries). */
  function pickSelectByKeywords(keywords, pool, used) {
    return pickElement(
      keywordMatches(pool, keywords, "SELECT"),
      used,
      (el) => el.tagName === "SELECT"
    );
  }

  // The orchestrator picks fields through this namespace: the rules for
  // choosing live here, running the passes stays in autofill.js.
  JA.matcher = {
    attributeMatches,
    keywordMatches,
    pickElement,
    pickField,
    pickSelect,
    pickSelectByKeywords
  };
})();
