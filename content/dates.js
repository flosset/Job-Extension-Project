// dates.js — handles "graduation date"-style pickers that ATS education
// sections render as a PAIR of <select> elements (Month + Year) instead of a
// single date input. The month select is detected by its option text, so no
// portal-specific naming is required.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Profile keys whose value is a date. */
  JA.DATE_KEYS = ["graduationDate", "startDate"];

  /** Does a <select> look like a month picker, a year picker, or neither? */
  function dateKind(select) {
    const texts = Array.from(select.options).map((o) => JA.normalize(o.textContent));
    const months = texts.filter((t) => t && JA.monthIndex(t)).length;
    const years = texts.filter((t) => /^\d{4}$/.test(t)).length;
    if (months >= 3) return "month";
    if (years >= 3) return "year";
    return null;
  }

  /** Selects whose label/name matches a date key's keywords. */
  function dateSelects(key, pool) {
    const keywords = JA.KEYWORDS[key];
    if (!keywords) return [];
    return pool.filter(
      (el) =>
        el.tagName === "SELECT" &&
        JA.matchesKeywords(JA.normalize(JA.getSignal(el)), keywords)
    );
  }

  /** Choose the option whose text exactly, then loosely, matches `token`. */
  function chooseByText(select, token) {
    const options = Array.from(select.options).filter(
      (o) => (o.value || "").trim() !== ""
    );
    for (const option of options) {
      if (JA.normalize(option.textContent) === token) return option;
    }
    for (const option of options) {
      if (JA.normalize(option.textContent).startsWith(token)) return option;
    }
    return null;
  }

  /**
   * Fill month/year <select> pairs for the profile's date keys.
   * Returns how many selects were set.
   */
  JA.fillDateSelects = function (profile, pool, used) {
    let count = 0;
    for (const key of JA.DATE_KEYS) {
      const parts = JA.toIsoParts(profile[key]);
      if (!parts) continue;

      for (const select of dateSelects(key, pool)) {
        if (used.has(select) || JA.isFilled(select)) continue;

        const kind = dateKind(select);
        let option = null;
        if (kind === "month") {
          option = chooseByText(select, JA.MONTH_NAMES[parts.month - 1]);
        } else if (kind === "year") {
          option = chooseByText(select, String(parts.year));
        }
        if (!option) continue;

        try {
          JA.selectOption(select, option);
        } catch (err) {
          continue;
        }
        used.add(select);
        count++;
      }
    }
    return count;
  };
})();
