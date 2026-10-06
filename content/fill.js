// fill.js — the generic per-field dispatcher. Given a scope, a set of label
// keywords and a value, it finds the field ANY way a portal might render it
// (text input, native <select>, react-select combobox, contenteditable) and
// fills it. Shared by the page-wide passes and by repeatable sections, so a
// block behaves like a mini-form regardless of the platform's UI library.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Fill one already-found element according to its widget type. */
  function fillElement(el, value) {
    if (el.tagName === "SELECT") {
      return JA.assignFieldValue(el, value);
    }
    JA.assignValue(el, value);
    // Masked/controlled widgets (e.g. Workday dates) may reject a plain value.
    if (!JA.isFilled(el) && JA.typeIntoElement) {
      JA.typeIntoElement(el, value);
    }
    return JA.isFilled(el);
  }

  /**
   * Fill the first field within `root` whose label matches `keywords`.
   * Prefers a custom dropdown when one matches; otherwise a select/text field.
   * Returns true when a value was actually set.
   */
  JA.fillFieldByKeywords = async function (root, keywords, value, opts) {
    opts = opts || {};
    if (!keywords || !keywords.length) return false;
    const scope = root || document;
    const used = opts.used || new Set();

    // 1. Custom (react-select style) dropdown inside the scope.
    if (JA.comboControlForKeywords && JA.chooseComboByKeywords) {
      if (JA.comboControlForKeywords(keywords, used, scope)) {
        return await JA.chooseComboByKeywords(keywords, value, used, scope);
      }
    }

    // 2. Native <select> / text input / contenteditable.
    const el = JA.findFieldByKeywords(scope, keywords, opts);
    if (!el) return false;
    return fillElement(el, value);
  };
})();
