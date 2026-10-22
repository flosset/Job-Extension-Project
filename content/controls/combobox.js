// combobox.js â€” drives custom (react-select style) dropdowns, which modern
// ATS forms (Greenhouse, Workday, â€¦) use instead of <select>. Opens the
// control, hovers the matching option, commits with several fallback
// strategies, then closes the menu.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Is this input the search box of a custom dropdown? */
  JA.isComboboxInput = function (el) {
    return (
      el.getAttribute("role") === "combobox" ||
      el.classList.contains("select__input") ||
      !!el.closest('[class*="select__control"]')
    );
  };

  /** All react-select style dropdown controls under `root` (default: page). */
  JA.comboControls = function (root) {
    return JA.queryAll('[class*="select__control"]', root || document);
  };

  /** Find the un-answered dropdown control whose label matches keywords. */
  JA.comboControlForKeywords = function (keywords, used, root) {
    if (!keywords || !keywords.length) return null;
    for (const control of JA.comboControls(root)) {
      if (used.has(control) || JA.comboValueEl(control)) continue;
      if (control.getAttribute("aria-disabled") === "true") continue;
      const input = JA.comboInput(control);
      const signal = JA.normalize(JA.getSignal(input || control));
      if (JA.matchesKeywords(signal, keywords)) return control;
    }
    return null;
  };

  /** Find the dropdown control whose label matches a key's keywords. */
  JA.comboControlFor = function (key, used) {
    return JA.comboControlForKeywords(JA.KEYWORDS[key], used);
  };

  /** Wait until the open dropdown has rendered its option elements. */
  JA.waitForOptions = function (timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const options = JA.queryAll(
          '[class*="select__option"], [role="option"]'
        );
        if (options.length > 0 || Date.now() > deadline) {
          resolve(Array.from(options));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  };

  /**
   * Pick the option element whose text matches the stored value.
   * Delegates to the shared, negation-safe picker so a stored "Yes" can never
   * commit an option that reads "I am not authorized to work".
   */
  JA.matchOptionElement = function (options, value) {
    const candidates = options.map((option) => ({
      el: option,
      text: JA.normalize(option.textContent),
      value: JA.normalize(option.getAttribute("data-value") || "")
    }));
    return JA.pickPolaritySafe(candidates, value);
  };

  /** The search input inside a dropdown control. */
  JA.comboInput = function (control) {
    return (
      control.querySelector('input[role="combobox"]') ||
      control.querySelector("input")
    );
  };

  /** The element that shows a committed value (absent until one is chosen). */
  JA.comboValueEl = function (control) {
    return control.querySelector(
      '[class*="select__single-value"], [class*="singleValue"]'
    );
  };

  /** Did the dropdown actually commit a value? */
  JA.comboCommitted = async function (control, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (JA.comboValueEl(control)) return true;
      await JA.sleep(40);
    } while (Date.now() < deadline);
    return false;
  };

  /** All currently rendered dropdown options. */
  JA.optionElements = function () {
    return JA.queryAll('[class*="select__option"], [role="option"]');
  };

  /**
   * The options belonging to ONE control's menu.
   *
   * Prefers the control's own container, so a menu that some other dropdown left
   * open on the page can never be mistaken for this one's â€” otherwise a click
   * meant for Education block 2 could land on block 1's leftover list. Falls back
   * to the whole page only when the container holds no options at all (a portal
   * that renders its menu somewhere unreachable from the control).
   */
  JA.optionsForControl = function (control) {
    const container =
      (control.closest &&
        control.closest('[class*="select-shell"], [class*="select__container"]')) ||
      control.parentElement;
    try {
      if (container && container.querySelectorAll) {
        const own = Array.from(
          container.querySelectorAll('[class*="select__option"], [role="option"]')
        );
        if (own.length > 0) return own;
      }
    } catch (err) {
      /* fall through to the page-wide list */
    }
    return JA.optionElements();
  };

  /** Is this control's dropdown menu currently open? */
  JA.isComboOpen = function (control) {
    const input = JA.comboInput(control);
    if (input && input.getAttribute("aria-expanded") === "true") return true;
    const container =
      control.closest('[class*="select-shell"]') || control.parentElement;
    return !!(container && container.querySelector('[class*="select__menu"]'));
  };

  /**
   * Force a dropdown closed. Multi-select widgets (e.g. Race/Ethnicity) keep
   * their list open after a choice, so we escalate until it is shut:
   *   1. Escape on the input + container + document, and blur the input;
   *   2. if still open, click the control to toggle the menu shut;
   *   3. if still open, an outside mousedown so react-select blurs and closes.
   */
  JA.closeCombo = async function (control) {
    const escape = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true
    };
    const input = JA.comboInput(control);
    const container =
      control.closest('[class*="select-shell"]') || control.parentElement;

    if (input) {
      input.dispatchEvent(new KeyboardEvent("keydown", escape));
      if (typeof input.blur === "function") input.blur();
    }
    if (container) container.dispatchEvent(new KeyboardEvent("keydown", escape));
    document.body.dispatchEvent(new KeyboardEvent("keydown", escape));

    await JA.sleep(120);
    if (!JA.isComboOpen(control)) return;

    // Multi-select keeps the menu open â€” clicking the control toggles it shut.
    JA.mouseClick(control);
    await JA.sleep(150);
    if (!JA.isComboOpen(control)) return;

    document.body.dispatchEvent(new MouseEvent("mousedown", JA.mouseOpts()));
    document.body.dispatchEvent(new MouseEvent("mouseup", JA.mouseOpts()));
  };

  /**
   * Choose an option on a custom dropdown. Opens the menu, hovers the matching
   * option, then tries several commit strategies until one sticks â€” because
   * different react-select builds listen for different events:
   *   1. a normal mouse click on the option,
   *   2. Enter on the input (react-select selects the *hovered* option),
   *   3. a bare click, re-opening the menu first if it closed.
   * The dropdown is always closed afterwards.
   */
  JA.chooseComboOption = async function (key, value, used) {
    return JA.chooseComboByKeywords(JA.KEYWORDS[key], value, used);
  };

  /**
   * Open the dropdown matching `keywords`, read its option list, and commit
   * `value` if an option matches. `value` comes from either a fixed profile key
   * or a user answer-bank entry, which is how arbitrary portal questions (e.g.
   * "Preferred office location") get answered reactively â€” we only select an
   * option that genuinely exists.
   */
  JA.chooseComboByKeywords = async function (keywords, value, used, root) {
    const control = JA.comboControlForKeywords(keywords, used, root);
    if (!control) return false;

    // Set when the value had to be TYPED to make the widget render its options.
    let typed = false;
    // Resolved out here so the cleanup in `finally` can reach it too.
    const input = JA.comboInput(control);

    try {
      if (input && typeof input.focus === "function") input.focus();
      JA.mouseClick(control);
      await JA.waitForOptions(900);

      let hovered = JA.matchOptionElement(JA.optionsForControl(control), value);

      // Type-to-search. A searchable widget renders NO options until you type â€”
      // Greenhouse's School picker (thousands of universities from their API) and
      // any react-select fed by the portal's own search are like this. Without
      // this step the list stays empty and the field looks unfillable when it is
      // merely waiting for input. Typing is exactly what a person does here.
      const searchable =
        !!input && !input.readOnly && !input.disabled &&
        input.getAttribute("readonly") === null;
      if (!hovered && searchable) {
        try {
          JA.assignValue(input, value);
          typed = true;
        } catch (err) {
          /* a widget that refuses the text is simply not searchable */
        }
        await JA.waitForOptions(1200);
        hovered = JA.matchOptionElement(JA.optionsForControl(control), value);
      }

      if (!hovered) {
        // Nothing matched: leave no stray search text behind.
        if (searchable) {
          try {
            JA.assignValue(input, "");
          } catch (err) {
            /* ignore */
          }
        }
        return false;
      }

      // Hover the match so react-select's "focused option" becomes the target.
      hovered.dispatchEvent(new MouseEvent("mouseover", JA.mouseOpts()));
      hovered.dispatchEvent(new MouseEvent("mousemove", JA.mouseOpts()));

      // Strategy 1 â€” click the option (re-queried in case React re-rendered it).
      let option = JA.matchOptionElement(JA.optionsForControl(control), value) || hovered;
      JA.mouseClick(option);
      if (await JA.comboCommitted(control, 300)) {
        used.add(control);
        return true;
      }

      // Strategy 2 â€” Enter on the input selects the hovered option.
      if (input) {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true
          })
        );
        if (await JA.comboCommitted(control, 300)) {
          used.add(control);
          return true;
        }
      }

      // Strategy 3 â€” bare click, re-opening the menu if it already closed.
      option = JA.matchOptionElement(JA.optionsForControl(control), value);
      if (!option) {
        JA.mouseClick(control);
        await JA.waitForOptions(600);
        option = JA.matchOptionElement(JA.optionsForControl(control), value);
      }
      if (option) {
        option.dispatchEvent(new MouseEvent("click", JA.mouseOpts()));
        if (await JA.comboCommitted(control, 300)) {
          used.add(control);
          return true;
        }
      }

      return false;
    } finally {
      // A search box must not be left holding our query: on builds that do not
      // clear it themselves it would be submitted as the field's own text. Safe
      // because a control that shows its committed value in its own element has
      // an input that is purely a search box.
      if (typed && input && JA.comboValueEl(control)) {
        try {
          JA.assignValue(input, "");
        } catch (err) {
          /* ignore */
        }
      }
      await JA.closeCombo(control);
    }
  };

  /**
   * Fill every self-identification key rendered as a custom widget, then any
   * answer-bank entry whose keyword matches a dropdown.
   */
  JA.fillCombosPass = async function (profile, used) {
    used = used || new Set();
    let count = 0;

    // Every profile key that has a value: the driver only commits when the
    // dropdown's own option list contains the value, so trying all keys is safe
    // and covers address fields, self-ID, and arbitrary portal questions.
    for (const key of Object.keys(JA.KEYWORDS)) {
      const value = profile[key];
      if (!value || typeof value !== "string") continue;
      try {
        if (await JA.chooseComboByKeywords(JA.KEYWORDS[key], value, used)) count++;
      } catch (err) {
        /* skip an uncooperative widget */
      }
    }

    // Answer-bank entries also drive dropdowns (feature 4 â†’ reactive selects).
    const snippets = Array.isArray(profile.customSnippets)
      ? profile.customSnippets
      : [];
    for (const snippet of snippets) {
      const key = snippet && snippet.key;
      const value = snippet && snippet.value;
      if (!key || !value || typeof value !== "string") continue;
      const keywords = JA.snippetKeywords(key);
      if (!keywords.length) continue;
      try {
        if (await JA.chooseComboByKeywords(keywords, value, used)) count++;
      } catch (err) {
        /* skip */
      }
    }

    return count;
  };

  // --- Reveal options (for questions we cannot answer) --------------------

  /** Human label for a dropdown control, with any required asterisk stripped. */
  JA.comboLabel = function (control) {
    const input = JA.comboInput(control);
    const bits = [
      input ? input.getAttribute("aria-label") : "",
      input ? JA.labelTextFor(input) : "",
      JA.labelTextFor(control),
      control.getAttribute("aria-label"),
      input ? input.getAttribute("name") : ""
    ];
    for (const bit of bits) {
      const text = (bit || "")
        .replace(/\s+/g, " ")
        .replace(/\s*\*+\s*$/, "")
        .trim();
      if (text) return text.slice(0, 80);
    }
    return "";
  };

  /** Is this dropdown marked required (asterisk, aria-required, class)? */
  JA.comboRequired = function (control) {
    const input = JA.comboInput(control);
    if (input && (input.required || input.getAttribute("aria-required") === "true")) {
      return true;
    }
    if (control.getAttribute("aria-required") === "true") return true;
    if (typeof control.className === "string" && /required/i.test(control.className)) {
      return true;
    }
    const raw = [
      input ? input.getAttribute("aria-label") : "",
      input ? JA.labelTextFor(input) : "",
      JA.labelTextFor(control)
    ].join(" ");
    return /\*/.test(raw);
  };

  /**
   * Open each required, still-unanswered dropdown, read its options, close it,
   * and return { label, required, ref } entries. We NEVER select anything here â€”
   * this only tells the user which choices the form actually offers, so they
   * can decide. Capped so it stays quick.
   */
  JA.revealComboOptions = async function (limit) {
    const cap = limit || 5;
    const out = [];
    for (const control of JA.comboControls()) {
      if (out.length >= cap) break;
      if (JA.comboValueEl(control)) continue;
      if (control.getAttribute("aria-disabled") === "true") continue;
      if (!JA.comboRequired(control)) continue;

      const label = JA.comboLabel(control);
      if (!label) continue;

      try {
        const input = JA.comboInput(control);
        if (input && typeof input.focus === "function") input.focus();
        JA.mouseClick(control);
        const options = await JA.waitForOptions(500);

        const texts = [];
        for (const option of options) {
          const text = (option.textContent || "").replace(/\s+/g, " ").trim();
          if (text && texts.indexOf(text) === -1) texts.push(text);
          if (texts.length >= 8) break;
        }
        if (texts.length > 0) {
          out.push({
            label: label + "  â†’  " + texts.join(" Â· "),
            required: true,
            ref: JA.refFor ? JA.refFor(control) : null
          });
        }
      } catch (err) {
        /* skip */
      } finally {
        await JA.closeCombo(control);
      }
    }
    return out;
  };

  /**
   * Run combo filling, retrying once if the widgets had not hydrated yet.
   * `used` is the run-wide ownership set, so a dropdown a remembered widget (or
   * an earlier pass) already filled is never opened and answered again.
   */
  JA.fillCombos = async function (profile, used) {
    let count = await JA.fillCombosPass(profile, used);
    if (count === 0 && JA.comboControls().length > 0) {
      await JA.sleep(1200);
      count = await JA.fillCombosPass(profile, used);
    }
    return count;
  };
})();
