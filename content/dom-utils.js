// dom-utils.js — shared, side-effect-free DOM & text helpers used by the
// matcher, the native-field injector and the combobox driver.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Normalise free text to lowercase, space-separated words. */
  JA.normalize = function (text) {
    return (text || "")
      .toLowerCase()
      .replace(/[_\-.]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  /** Escape regex metacharacters in a token. */
  JA.escapeRegExp = function (text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  /** All <label> elements explicitly bound to a field via for/id. */
  JA.labelsFor = function (el) {
    if (!el || !el.id) return [];
    const escaped = String(el.id).replace(/["\\]/g, "\\$&");
    try {
      return Array.from(document.querySelectorAll('label[for="' + escaped + '"]'));
    } catch (err) {
      return [];
    }
  };

  /** Collect every human-readable hint attached to a field. */
  JA.getSignal = function (el) {
    const bits = [];
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) bits.push(ariaLabel);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const node = document.getElementById(id);
        if (node) bits.push(node.textContent);
      });
    }

    JA.labelsFor(el).forEach((label) => bits.push(label.textContent));

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) bits.push(wrappingLabel.textContent);

    // Fallback for portals that place the label beside the field without a
    // `for`/id link. Portals like Workday wrap the input in a div, so the
    // label can sit 1–3 levels up — walk up until a usable label is found.
    // Labels bound to a *different* field (or wrapping their own control) are
    // ignored, so a page-level label can't match every sibling field.
    let ancestor = el.parentElement;
    for (let level = 0; ancestor && level < 3; level++) {
      let found = false;
      for (const child of ancestor.children) {
        if (child === el || child.tagName !== "LABEL") continue;
        const forId = child.getAttribute("for");
        if (forId && forId !== el.id) continue;
        if (child.querySelector("input, select, textarea")) continue;
        bits.push(child.textContent);
        found = true;
      }
      if (found) break;
      ancestor = ancestor.parentElement;
    }

    bits.push(el.getAttribute("placeholder"));
    bits.push(el.getAttribute("name"));
    bits.push(el.id);
    bits.push(el.getAttribute("autocomplete"));

    return bits.filter(Boolean).join(" ");
  };

  /** Does any keyword appear as a whole word in the normalised signal? */
  JA.matchesKeywords = function (signal, keywords) {
    return keywords.some((keyword) =>
      new RegExp("(^| )" + keyword + "( |$)").test(signal)
    );
  };

  /** A field is usable only if it is visible and not disabled/read-only. */
  JA.isFillable = function (el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === "INPUT") {
      const type = (el.type || "").toLowerCase();
      if (JA.NON_TEXT_INPUT_TYPES.indexOf(type) !== -1) return false;
    }
    // Hidden via display:none / visibility:hidden / zero layout box.
    if (el.getClientRects().length === 0) return false;
    return true;
  };

  /** Is a <select> still showing its placeholder / nothing chosen? */
  JA.isSelectEmpty = function (el) {
    if (el.selectedIndex < 0) return true;
    const option = el.options[el.selectedIndex];
    if (!option) return true;
    if ((option.value || "").trim() === "") return true;
    // Placeholder-ish labels such as "Please select", "Choose one", "--".
    return /^(select|choose|please|pick)($| )/.test(
      JA.normalize(option.textContent)
    );
  };

  /** Has the element already got content the user typed/chose? */
  JA.isFilled = function (el) {
    if (el.tagName === "SELECT") return !JA.isSelectEmpty(el);
    const text = el.isContentEditable ? el.textContent : el.value;
    return (text || "").trim().length > 0;
  };

  // --- Locating a field from the popup -------------------------------------
  // The popup and the page are different contexts, so the popup can only ask
  // "show me this one" by handle. We tag the element and look it up again.

  JA.REF_ATTR = "data-ja-ref";
  let _jaRefSeq = 0;

  /** Stable handle for an element, so the popup can point back at it. */
  JA.refFor = function (el) {
    if (!el || !el.getAttribute) return null;
    let ref = el.getAttribute(JA.REF_ATTR);
    if (!ref) {
      _jaRefSeq++;
      ref = "ja-" + Date.now().toString(36) + "-" + _jaRefSeq;
      el.setAttribute(JA.REF_ATTR, ref);
    }
    return ref;
  };

  JA.findByRef = function (ref) {
    if (!ref) return null;
    try {
      return document.querySelector("[" + JA.REF_ATTR + '="' + ref + '"]');
    } catch (err) {
      return null;
    }
  };

  /** Visible to the user (laid out), regardless of whether it takes text. */
  JA.isVisible = function (el) {
    if (!el || el.disabled) return false;
    try {
      return el.getClientRects().length > 0;
    } catch (err) {
      return true;
    }
  };

  /** Is this control marked required (attribute, aria, or a "*" in its label)? */
  JA.isRequiredField = function (el) {
    if (!el) return false;
    if (el.required) return true;
    if (el.getAttribute("aria-required") === "true") return true;
    const text = JA.labelTextFor ? JA.labelTextFor(el) : "";
    if (/\*/.test(text)) return true;
    if (/\*/.test(el.getAttribute("aria-label") || "")) return true;
    return /(^| )required( |$)/.test(JA.normalize(JA.getSignal(el)));
  };

  /** Briefly outline an element and scroll it into view, on request. */
  JA.flashElement = function (el, ms) {
    if (!el) return;
    const STYLE_ID = "__jobAutofillFlashStyle";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        "@keyframes jaFlash {",
        "  0%, 100% { outline-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.45); }",
        "  50%      { outline-color: #fde68a; box-shadow: 0 0 0 8px rgba(253, 230, 138, 0.55); }",
        "}",
        "[data-ja-flash] {",
        "  outline: 3px solid #f59e0b !important;",
        "  outline-offset: 2px !important;",
        "  border-radius: 6px !important;",
        "  animation: jaFlash 1s ease-in-out 3 !important;",
        "}"
      ].join("\n");
      (document.head || document.documentElement).appendChild(style);
    }
    el.setAttribute("data-ja-flash", "1");
    setTimeout(() => el.removeAttribute("data-ja-flash"), ms || 3200);
  };

  /** Scroll to an element and flash it (used by the popup's field list). */
  JA.locateElement = function (el) {
    if (!el) return false;
    try {
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } catch (err) {
      /* older engines: no options object */
    }
    try {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    } catch (err) {
      /* a non-focusable wrapper is fine */
    }
    JA.flashElement(el);
    return true;
  };

  /** Expand a stored value into the tokens to look for in option text. */
  JA.expandValueTokens = function (value) {
    const primary = JA.normalize(value);
    const synonyms = (JA.VALUE_SYNONYMS[primary] || []).slice();

    // US state abbreviations ↔ full names ("TX" ↔ "Texas").
    const abbr = JA.STATE_ABBR || {};
    if (abbr[primary]) {
      synonyms.push(abbr[primary]);
    } else {
      for (const key in abbr) {
        if (abbr[key] === primary) synonyms.push(key);
      }
    }

    return [primary].concat(synonyms.filter(Boolean));
  };

  /**
   * Match keywords for a user answer-bank key: the whole normalised phrase plus
   * its significant words, so "Desired Salary" also matches a field labelled
   * just "Salary".
   */
  JA.snippetKeywords = function (rawKey) {
    const normalized = JA.normalize(rawKey);
    if (!normalized) return [];
    const out = [normalized];
    normalized
      .split(" ")
      .filter((word) => word.length >= 4)
      .forEach((word) => {
        if (out.indexOf(word) === -1) out.push(word);
      });
    return out;
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

  /**
   * Simulate real typing into a masked / controlled input. Some widgets
   * (Workday's date fields) ignore a programmatic .value and only respond to
   * keyboard-driven input, so we focus, then insert the text via the browser's
   * own insertText, falling back to a per-character key simulation.
   */
  JA.typeIntoElement = function (el, text) {
    const value = String(text == null ? "" : text);
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (err) {
      /* ignore */
    }

    let inserted = false;
    try {
      if (typeof el.select === "function") el.select();
      inserted = document.execCommand("insertText", false, value);
    } catch (err) {
      inserted = false;
    }

    if (!inserted) {
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      const setValue = (v) => {
        if (descriptor && typeof descriptor.set === "function") {
          descriptor.set.call(el, v);
        } else {
          el.value = v;
        }
      };
      setValue("");
      let acc = "";
      for (const ch of value) {
        acc += ch;
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        setValue(acc);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch })
        );
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
      }
    }

    JA.dispatchFormEvents(el);
    return JA.isFilled(el);
  };

  /** Choose an option on a <select> via the native setter + form events. */
  JA.selectOption = function (select, option) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    );
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(select, option.value);
    } else {
      select.value = option.value;
    }
    select.selectedIndex = option.index;
    JA.dispatchFormEvents(select);
  };

  // --- Field injection -----------------------------------------------------

  /** Write into an input/textarea/select via the native setter + form events. */
  JA.injectValue = function (el, value) {
    const adapted = JA.adaptValueForInput(el, value);
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, adapted);
    } else {
      el.value = adapted;
    }
    JA.dispatchFormEvents(el);
  };

  /** Rich-text blocks have no .value — write textContent instead. */
  JA.injectIntoEditable = function (el, value) {
    el.textContent = value;
    JA.dispatchFormEvents(el);
  };

  /** Assign a value to whichever kind of field we were given. */
  JA.assignValue = function (el, value) {
    if (el.isContentEditable) {
      JA.injectIntoEditable(el, value);
    } else {
      JA.injectValue(el, value);
    }
  };

  // --- Answer polarity (negation-safe matching) ----------------------------
  // The dangerous failure this prevents: a stored "Yes" landing on an option
  // reading "I am not authorized to work in the US". Containment alone cannot
  // tell those apart, so we work out the *answer* both sides express — yes,
  // no or decline — and only accept a candidate when the two AGREE. If either
  // side is undecidable we fall back to plain matching, and if nothing agrees
  // we return null (an empty field beats a wrong answer).

  /** Cues that flip an affirmative statement into a negative answer. */
  JA.NEGATION =
    /(^| )(not|n t|never|no longer|dont|don t|do not|does not|did not|am not|is not|are not|will not|would not|cannot|can not|neither|nor|none|unable)( |$)/;

  /** Options that mean "I would rather not answer". */
  JA.DECLINE_PATTERN =
    /(prefer not|decline|do not wish|don t wish|not to disclose|choose not|wish to answer|no answer|not to say|do not want|rather not)/;

  JA.matchesDecline = function (text) {
    return JA.DECLINE_PATTERN.test(text || "");
  };

  /**
   * Which *answer* does a stored value express?
   *   "Yes"                            -> "yes"
   *   "I am a protected veteran"       -> "yes"  (un-negated statement)
   *   "I am not a protected veteran"   -> "no"   (negated statement)
   *   "No, I do not have a disability" -> "no"   (leading answer word)
   *   "Prefer not to say"              -> "decline"
   *   "Male" / "Texas" / "MS"          -> null   (not a yes/no question)
   */
  JA.answerPolarity = function (value) {
    const text = JA.normalize(value);
    if (!text) return null;
    if (JA.matchesDecline(text)) return "decline";
    if (/^(no|n|false)\b/.test(text)) return "no";
    if (/^(yes|y|true)\b/.test(text)) return "yes";
    if (/^(i am not|i do not|i don t|i am no longer|not |never )/.test(text)) {
      return "no";
    }
    if (/^(i am|i do|i have|i was|i served|i currently|i will|i would)/.test(text)) {
      return "yes";
    }
    return null;
  };

  /**
   * Which answer does an option/radio label express? Same rules, read off the
   * label: a leading "Yes"/"No" wins; otherwise a negation cue positioned
   * BEFORE the matched token flips it (so "authorized to work without a
   * sponsor" stays positive while "not authorized to work" does not).
   */
  JA.candidatePolarity = function (text, token) {
    const t = JA.normalize(text);
    if (!t) return null;
    if (JA.matchesDecline(t)) return "decline";
    if (/^(yes|y|true)\b/.test(t)) return "yes";
    if (/^(no|n|false)\b/.test(t)) return "no";
    // A negator positioned BEFORE the matched token flips the statement
    // ("not authorized to work" -> no) while one that follows it does not
    // ("authorized to work without a sponsor" -> yes). A negated *token*
    // itself ("i do not require") is decisive on its own.
    const at = token ? t.indexOf(token) : -1;
    const scope = at > 0 ? t.slice(0, at) : t;
    if (JA.NEGATION.test(scope) || JA.NEGATION.test(token || "")) return "no";
    return "yes";
  };

  /**
   * Negation-safe candidate picker, shared by native <select> options,
   * react-select options and radio buttons.
   * `candidates` = [{ el, text, value }] with normalised text/value.
   *
   * Pass 1/2 — exact equality (strongest signal).
   * Pass 3/4 — whole-word containment, longest token first.
   * Every pass is gated by polarity, so "Yes" can never land on a negated
   * option and an unanswerable question is left blank instead of guessed.
   */
  JA.pickPolaritySafe = function (candidates, value) {
    if (!candidates || candidates.length === 0) return null;
    const tokens = JA.expandValueTokens(value);
    const desired = JA.answerPolarity(value);
    const agrees = (surface, token) =>
      !desired || JA.candidatePolarity(surface, token) === desired;

    for (const token of tokens) {
      for (const c of candidates) {
        if (c.text === token && agrees(c.text, token)) return c.el;
      }
    }
    for (const token of tokens) {
      for (const c of candidates) {
        if (c.value === token && agrees(c.value, token)) return c.el;
      }
    }

    const ordered = tokens.slice().sort((a, b) => b.length - a.length);
    for (const token of ordered) {
      const pattern = new RegExp("(^| )" + JA.escapeRegExp(token) + "( |$)");
      for (const c of candidates) {
        if (!pattern.test(c.text)) continue;
        if (!agrees(c.text, token)) continue;
        return c.el;
      }
    }
    for (const token of ordered) {
      const pattern = new RegExp("(^| )" + JA.escapeRegExp(token) + "( |$)");
      for (const c of candidates) {
        if (!pattern.test(c.value)) continue;
        if (!agrees(c.value, token)) continue;
        return c.el;
      }
    }
    return null;
  };

  /**
   * Find the <option> whose text/value best matches the stored value.
   * Pass 1: exact (normalised) equality. Pass 2: whole-word containment, so
   * "Male" also matches an option reading "Man" — but negation-safe, so "Yes"
   * can never match "Not authorized".
   */
  JA.findOptionForValue = function (select, value) {
    const options = Array.from(select.options).filter(
      (option) => (option.value || "").trim() !== ""
    );
    const candidates = options.map((option) => ({
      el: option,
      text: JA.normalize(option.textContent),
      value: JA.normalize(option.value)
    }));
    return JA.pickPolaritySafe(candidates, value);
  };

  /** Assign a value to a field, choosing the right <option> for selects. */
  JA.assignFieldValue = function (el, value) {
    if (el.tagName === "SELECT") {
      const option = JA.findOptionForValue(el, value);
      if (!option) return false;
      JA.selectOption(el, option);
      return true;
    }
    JA.assignValue(el, value);
    return true;
  };

  /** Tick/untick a checkbox the way a framework will actually notice. */
  JA.setCheckbox = function (el, checked) {
    if (el.checked !== checked) JA.mouseClick(el);
    if (el.checked !== checked) {
      el.checked = checked;
      JA.dispatchFormEvents(el);
    }
  };

  /** First element under `root` whose label/signal matches the keywords. */
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
      if (opts.tagName && el.tagName !== opts.tagName) continue;
      if (opts.type && (el.type || "").toLowerCase() !== opts.type) continue;
      if (!opts.type && JA.isComboboxInput && JA.isComboboxInput(el)) continue;
      if (JA.matchesKeywords(JA.normalize(JA.getSignal(el)), keywords)) return el;
    }
    return null;
  };

  /** Text of the <label>s / aria-labelledby targets attached to an element. */
  JA.labelTextFor = function (el) {
    const bits = [];
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      by.split(/\s+/).forEach((id) => {
        const node = document.getElementById(id);
        if (node) bits.push(node.textContent);
      });
    }
    JA.labelsFor(el).forEach((label) => bits.push(label.textContent));
    const wrapping = el.closest("label");
    if (wrapping) bits.push(wrapping.textContent);
    return bits.filter(Boolean).join(" ");
  };

  /**
   * The *question* text for a radio-button group (not the option labels).
   * Reads the enclosing <fieldset><legend>, a [role="radiogroup"] label, the
   * radios' own aria text, and the nearest shared container's heading.
   */
  JA.radioGroupSignal = function (radios) {
    const first = radios[0];
    const bits = [];

    const fieldset = first.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) bits.push(legend.textContent);
    }

    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      bits.push(group.getAttribute("aria-label"));
      bits.push(JA.labelTextFor(group));
    }

    bits.push(first.getAttribute("aria-label"));
    bits.push(JA.labelTextFor(first));

    // Nearest ancestor that contains the whole group: use its heading/label.
    let node = first.parentElement;
    while (node && !radios.every((r) => node.contains(r))) node = node.parentElement;
    if (node) {
      const heading = node.querySelector(
        'legend, h1, h2, h3, h4, h5, h6, .label, [class*="label"]'
      );
      if (heading) bits.push(heading.textContent);
    }

    bits.push(first.getAttribute("name"));
    return bits.filter(Boolean).join(" ");
  };

  /** Fire the events that framework-driven portals listen for. */
  JA.dispatchFormEvents = function (el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  /** Shared mouse-event options. */
  JA.mouseOpts = function () {
    return { bubbles: true, cancelable: true, view: window, button: 0 };
  };

  /** Fire a realistic mouse sequence so React widgets react to the click. */
  JA.mouseClick = function (el) {
    const opts = JA.mouseOpts();
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  };

  /** Promise-based delay. */
  JA.sleep = function (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
})();
