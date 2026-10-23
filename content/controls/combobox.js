// combobox.js â€” drives custom (react-select style) dropdowns, which modern
// ATS forms (Greenhouse, Workday, â€¦) use instead of <select>. Opens the
// control, hovers the matching option, commits with several fallback
// strategies, then closes the menu.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const selectedInputs = JA.comboSelections || (JA.comboSelections = new WeakMap());
  const visibleOption = el => JA.isVisible(el) && el.getAttribute("aria-disabled") !== "true" &&
    el.getAttribute("data-automation-id") !== "selectedItem";

  /** Is this input the search box of a custom dropdown? */
  JA.isComboboxInput = function (el) {
    return (
      el.getAttribute("role") === "combobox" ||
      el.getAttribute("aria-autocomplete") === "list" ||
      el.getAttribute("aria-haspopup") === "listbox" ||
      el.getAttribute("data-uxi-widget-type") === "selectinput" ||
      el.classList.contains("select__input") ||
      !!el.closest('[class*="select__control"]')
    );
  };

  /** All react-select style dropdown controls under `root` (default: page). */
  JA.comboControls = function (root) {
    const controls = JA.queryAll('[class*="select__control"], button[aria-haspopup="listbox"], [role="combobox"], input[aria-autocomplete="list"], input[data-uxi-widget-type="selectinput"]', root || document);
    return [...new Set(controls.map(el => el.closest('[class*="select__control"]') ||
      el.closest('[data-automation-id="multiselectInputContainer"]') ||
      (el.tagName === "INPUT" ? el.parentElement : el)))];
  };

  JA.currentCombo = function (control) {
    if (control.isConnected) return control;
    if (control.id) return JA.currentField(control);
    const input = JA.comboInput(control);
    const current = input && JA.currentField(input);
    return current && (current.closest('[class*="select__control"], [data-automation-id="multiselectInputContainer"]') || current.parentElement);
  };

  /** Find the un-answered dropdown control whose label matches keywords. */
  JA.comboControlForKeywords = function (keywords, used, root) {
    if (!keywords || !keywords.length) return null;
    for (const control of JA.comboControls(root)) {
      if (used.has(control) || JA.comboValueEl(control) || !JA.isVisible(control)) continue;
      if (control.getAttribute("aria-disabled") === "true") continue;
      const input = JA.comboInput(control);
      if (input?.value.trim()) continue; // Preserve a user's selection or unfinished search.
      const signal = JA.normalize(JA.getSignal(input || control));
      if (JA.matchesKeywords(signal, keywords) ||
          (keywords.includes("city") && JA.normalize(JA.comboLabel(control)) === "location")) return control;
    }
    return null;
  };

  /** Find the dropdown control whose label matches a key's keywords. */
  JA.comboControlFor = function (key, used) {
    return JA.comboControlForKeywords(JA.KEYWORDS[key], used);
  };

  /** Wait until the open dropdown has rendered its option elements. */
  JA.waitForOptions = function (timeoutMs, control) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const options = control ? JA.optionsForControl(control) : JA.optionElements();
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
      text: JA.valueKey(option.querySelector?.('[class*="canonicalSchoolResultName"]')?.textContent || option.textContent),
      value: JA.valueKey(option.getAttribute("data-value") || "")
    }));
    return JA.pickPolaritySafe(candidates, value);
  };

  /** The search input inside a dropdown control. */
  JA.comboInput = function (control) {
    return (
      (control.tagName === "INPUT" ? control : null) ||
      control.querySelector('input[role="combobox"]') ||
      control.querySelector("input")
    );
  };

  /** The element that shows a committed value (absent until one is chosen). */
  JA.comboValueEl = function (control) {
    control = JA.currentCombo(control);
    if (!control) return null;
    const value = control.querySelector(
      '[class*="select__single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"], [data-automation-id="selectedItem"]'
    );
    if (value?.textContent.trim()) return value;
    // shortcut: input-only choices need an observed option commit; use a stored-selection marker when a site exposes one.
    const input = JA.comboInput(control);
    if (input && selectedInputs.get(input) === input.value && input.value.trim() &&
        input.getAttribute("aria-expanded") !== "true") return input;
    if (control.matches('button[aria-haspopup="listbox"]')) {
      const text = (control.textContent || "").trim();
      if (text && !/^(select|choose|please|pick)(\b|$)/i.test(text)) return control;
    }
    return null;
  };

  /** Did the dropdown actually commit a value? */
  JA.comboCommitted = async function (control, timeoutMs, expected) {
    const deadline = Date.now() + timeoutMs;
    do {
      control = JA.currentCombo(control);
      if (!control) return false;
      const selected = JA.comboValueEl(control);
      const input = JA.comboInput(control);
      const valid = control.getAttribute("aria-invalid") !== "true" && input?.getAttribute("aria-invalid") !== "true";
      if (valid && selected && (!expected || JA.matchOptionElement([{
        textContent: selected.tagName === "INPUT" ? selected.value : selected.textContent, getAttribute: () => ""
      }], expected))) return true;
      if (valid && expected && input && input.matches('.ashby-application-form-input-autocomplete') &&
          input.getAttribute("aria-expanded") === "false" && JA.valueKey(input.value) === JA.valueKey(expected)) {
        selectedInputs.set(input, input.value);
        return true;
      }
      await JA.sleep(40);
    } while (Date.now() < deadline);
    return false;
  };

  /** All currently rendered dropdown options. */
  JA.optionElements = function () {
    return JA.queryAll('[class*="select__option"], [role="option"]').filter(visibleOption);
  };

  /**
   * The options belonging to ONE control's menu.
   *
   * Prefers the control's own container, so a menu that some other dropdown left
   * open on the page can never be mistaken for this one's â€” otherwise a click
   * meant for Education block 2 could land on block 1's leftover list. Falls back
   * to a unique visible portal menu when no ownership link is available.
   */
  JA.optionsForControl = function (control) {
    control = JA.currentCombo(control);
    if (!control) return [];
    const input = JA.comboInput(control) || control;
    const ids = [...new Set([input, control].flatMap(el =>
      ((el.getAttribute("aria-controls") || "") + " " + (el.getAttribute("aria-owns") || "")).trim().split(/\s+/)
    ).filter(Boolean))];
    if (ids.length) {
      return ids.flatMap(id => {
        const menu = JA.rootOf(control).getElementById(id);
        return menu && JA.isVisible(menu)
          ? Array.from(menu.querySelectorAll('[class*="select__option"], [role="option"]')).filter(visibleOption) : [];
      });
    }
    const container =
      (control.closest &&
        control.closest('[class*="select-shell"], [class*="select__container"]')) ||
      control.parentElement;
    try {
      if (container && container.querySelectorAll) {
        const own = Array.from(
          container.querySelectorAll('[class*="select__option"], [role="option"]')
        ).filter(visibleOption);
        if (own.length > 0 && JA.comboControls(container).every(candidate => candidate === control)) return own;
      }
    } catch (err) {
      /* fall through to the page-wide list */
    }
    // A portalled menu without an ownership link is safe only when unique.
    const menus = JA.queryAll('[role="listbox"], [class*="select__menu"]').filter(JA.isVisible)
      .filter(menu => menu.getAttribute("data-automation-id") !== "selectedItemList")
      .filter(menu => !menu.parentElement?.closest('[role="listbox"], [class*="select__menu"]'));
    return JA.isComboOpen(control) && menus.length === 1
      ? JA.optionElements().filter(option => menus[0].contains(option)) : [];
  };

  /** Is this control's dropdown menu currently open? */
  JA.isComboOpen = function (control) {
    control = JA.currentCombo(control);
    if (!control) return false;
    if (control.getAttribute("aria-expanded") === "true") return true;
    const input = JA.comboInput(control);
    if (input && input.getAttribute("aria-expanded") === "true") return true;
    const container =
      control.closest('[class*="select-shell"]') || control.parentElement;
    return !!(container && Array.from(container.querySelectorAll('[class*="select__menu"]')).some(JA.isVisible));
  };

  /**
   * Force a dropdown closed. Multi-select widgets (e.g. Race/Ethnicity) keep
   * their list open after a choice, so we escalate until it is shut:
   *   1. Escape on the input + container + document, and blur the input;
   *   2. if still open, click the control to toggle the menu shut;
   *   3. if still open, an outside mousedown so react-select blurs and closes.
   */
  JA.closeCombo = async function (control) {
    control = JA.currentCombo(control);
    if (!control) return;
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
    } else {
      control.dispatchEvent(new KeyboardEvent("keydown", escape));
      control.blur();
    }
    if (container) container.dispatchEvent(new KeyboardEvent("keydown", escape));
    document.body.dispatchEvent(new KeyboardEvent("keydown", escape));

    await JA.sleep(120);
    if (!JA.isComboOpen(control)) return;

    // Multi-select keeps the menu open â€” clicking the control toggles it shut.
    JA.pressButton(JA.currentCombo(control));
    await JA.sleep(150);
    if (!JA.isComboOpen(control)) return;

    const outside = JA.queryAll('h1,h2,h3,[role="heading"]').find(el => el.textContent.trim() && JA.isVisible(el));
    JA.mouseClick(outside || document.body);
    await JA.sleep(80);
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
  /**
   * Open the dropdown matching `keywords`, read its option list, and commit
   * `value` if an option matches. `value` comes from either a fixed profile key
   * or a user answer-bank entry, which is how arbitrary portal questions (e.g.
   * "Preferred office location") get answered reactively â€” we only select an
   * option that genuinely exists.
   */
  JA.chooseComboByKeywords = async function (keywords, value, used, root) {
    const control = JA.comboControlForKeywords(keywords, used, root);
    return await JA.chooseComboControl(control, value, used);
  };

  JA.chooseComboControl = async function (control, value, used) {
    if (!control) return false;

    // Set when the value had to be TYPED to make the widget render its options.
    let typed = false;
    // Resolved out here so the cleanup in `finally` can reach it too.
    const input = JA.comboInput(control);

    try {
      if (input && typeof input.focus === "function") input.focus();
      else control.focus();
      JA.pressButton(control);
      await JA.waitForOptions(900, control);

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
        await JA.waitForOptions(1200, control);
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
      if (await JA.comboCommitted(control, 300, value)) {
        if (JA.comboAttempts) JA.comboAttempts.set(control, value);
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
        if (await JA.comboCommitted(control, 300, value)) {
          if (JA.comboAttempts) JA.comboAttempts.set(control, value);
          used.add(control);
          return true;
        }
      }

      // Strategy 3 â€” bare click, re-opening the menu if it already closed.
      option = JA.matchOptionElement(JA.optionsForControl(control), value);
      if (!option) {
        JA.pressButton(control);
        await JA.waitForOptions(600, control);
        option = JA.matchOptionElement(JA.optionsForControl(control), value);
      }
      if (option) {
        option.dispatchEvent(new MouseEvent("click", JA.mouseOpts()));
        if (await JA.comboCommitted(control, 300, value)) {
          if (JA.comboAttempts) JA.comboAttempts.set(control, value);
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
      if (typed && input && !input.matches('.ashby-application-form-input-autocomplete')) {
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
      // Greenhouse links the same label through both for and aria-labelledby.
      // Prefer its text once rather than the combined signal's duplicate.
      input && input.labels && input.labels[0] ? input.labels[0].textContent : "",
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
    if (JA.isRequiredField(input || control)) return true;
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
      if (!JA.isVisible(control)) continue;
      if (JA.comboValueEl(control)) continue;
      if (control.getAttribute("aria-disabled") === "true") continue;
      if (!JA.comboRequired(control)) continue;

      const label = JA.comboLabel(control);
      if (!label) continue;

      try {
        const input = JA.comboInput(control);
        if (input && typeof input.focus === "function") input.focus();
        else control.focus();
        JA.pressButton(control);
        const options = await JA.waitForOptions(500, control);

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
