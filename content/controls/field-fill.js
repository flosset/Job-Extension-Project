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
    return JA.valueCommitted(el, value);
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

    if (JA.fillSplitDate) {
      const date = await JA.fillSplitDate(scope, keywords, opts.dateValue || value, used);
      if (date !== null) return date;
    }

    if (JA.fillSegmentedDate) {
      const date = await JA.fillSegmentedDate(scope, keywords, value, used);
      if (date !== null) return date;
    }

    for (const group of JA.radioGroups ? JA.radioGroups() : []) {
      if (!group.every(el => scope.contains(el)) || group.some(el => used.has(el) || el.checked)) continue;
      if (!JA.matchesKeywords(JA.normalize(JA.radioGroupSignal(group)), keywords)) continue;
      const option = JA.pickPolaritySafe(group.map(el => ({ el,
        text: JA.valueKey(el.closest("label")?.textContent || el.getAttribute("aria-label") || el.value),
        value: JA.valueKey(el.value) })), value);
      if (!option) return false;
      JA.selectRadio(option);
      await JA.sleep(80);
      if (!option.checked) return false;
      group.forEach(el => used.add(el));
      return true;
    }

    // 1. Custom (react-select style) dropdown inside the scope.
    if (JA.comboControlForKeywords && JA.chooseComboByKeywords) {
      const answered = JA.comboControls(scope).find(control => JA.comboValueEl(control) &&
        JA.matchesKeywords(JA.normalize(JA.getSignal(JA.comboInput(control) || control)), keywords));
      if (answered) {
        const selected = JA.comboValueEl(answered);
        return !!JA.matchOptionElement([{ textContent: selected.value || selected.textContent, getAttribute: () => "" }], value);
      }
      if (JA.comboControlForKeywords(keywords, used, scope)) {
        return await JA.chooseComboByKeywords(keywords, value, used, scope);
      }
    }

    // 2. Native <select> / text input / contenteditable.
    const el = JA.findFieldByKeywords(scope, keywords, opts);
    if (!el) return false;
    const written = fillElement(el, value);
    await JA.sleep(80);
    const filled = written && JA.valueCommitted(el, el.tagName === "SELECT" ? el.value : value);
    // Claim it when it took the value: a later key in the same block — or a
    // later pass — must not be handed a control this one already answered.
    if (filled) used.add(el);
    return filled;
  };
})();
