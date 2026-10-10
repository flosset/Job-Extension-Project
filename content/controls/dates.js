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


  // --- Dates ---------------------------------------------------------------

  JA.MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];

  /** Month number (1-12) from a month name/abbreviation, else 0. */
  JA.monthIndex = function (name) {
    const key = String(name || "").toLowerCase().slice(0, 3);
    for (let i = 0; i < 12; i++) {
      if (JA.MONTH_NAMES[i].slice(0, 3) === key) return i + 1;
    }
    return 0;
  };

  /**
   * Parse a user-supplied date into { year, month, day } or null.
   * Accepts ISO (2026-05-15), "May 2026", "05/2026", "05/15/2026", "2026".
   */
  JA.toIsoParts = function (value) {
    const text = String(value || "").trim();
    if (!text) return null;

    let m = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (m) return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : 1 };

    m = text.match(/^([a-z]{3,})[^a-z0-9]*(\d{4})$/i);
    if (m) {
      const month = JA.monthIndex(m[1]);
      if (month) return { year: +m[2], month, day: 1 };
    }

    m = text.match(/^(\d{4})[^a-z0-9]*([a-z]{3,})$/i);
    if (m) {
      const month = JA.monthIndex(m[2]);
      if (month) return { year: +m[1], month, day: 1 };
    }

    m = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (m) return { year: +m[3], month: +m[1], day: +m[2] };

    m = text.match(/^(\d{1,2})[/.](\d{4})$/);
    if (m) return { year: +m[2], month: +m[1], day: 1 };

    m = text.match(/^(\d{4})$/);
    if (m) return { year: +m[1], month: 1, day: 1 };

    return null;
  };

  /** Convert a value into the exact format a date/month input requires. */
  JA.adaptValueForInput = function (el, value) {
    if (!el || el.tagName !== "INPUT") return value;
    const type = (el.type || "").toLowerCase();
    if (type !== "date" && type !== "month") return value;

    const parts = JA.toIsoParts(value);
    if (!parts) return value;

    const pad = (n) => String(n).padStart(2, "0");
    if (type === "month") return parts.year + "-" + pad(parts.month);
    return parts.year + "-" + pad(parts.month) + "-" + pad(parts.day);
  };

  /** Convert any date-ish value to MM/YYYY (Workday's date-mask format). */
  JA.toMonthYear = function (value) {
    const parts = JA.toIsoParts(value);
    if (!parts) return value;
    return String(parts.month).padStart(2, "0") + "/" + parts.year;
  };

  /** Convert any date-ish value to a bare 4-digit year (YYYY). */
  JA.toYear = function (value) {
    const parts = JA.toIsoParts(value);
    if (parts) return String(parts.year);
    const m = String(value || "").match(/\d{4}/);
    return m ? m[0] : value;
  };
})();
