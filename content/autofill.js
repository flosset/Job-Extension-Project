// autofill.js — orchestrator. Injected on demand by popup.js via
// chrome.scripting.executeScript together with field-map.js, dom-utils.js and
// combobox.js (in that order); they share the window.__JobAutofill namespace.
//
// Reads the profile from chrome.storage.local, fills matching fields, and
// reports the outcome back to the popup. Writes values through the native
// prototype setter and dispatches bubbling input/change/blur so React/Workday
// portals capture the change instead of ignoring a programmatic assignment.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  // Guard against overlapping runs if the button is clicked twice quickly.
  // We still REPORT, because the popup counts on every injected frame
  // answering — silence would look like a lost frame.
  if (window.__jobAutofillActive) {
    report({ status: "busy" });
    return;
  }
  window.__jobAutofillActive = true;

  const STORAGE_KEY = "jobProfile";

  // --- Matcher ------------------------------------------------------------

  /** All elements matched by a list of CSS attribute selectors. */
  function attributeMatches(selectorList) {
    const out = [];
    for (const selector of selectorList || []) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (err) {
        continue; // Ignore any selector the browser can't parse.
      }
      for (const el of nodes) out.push(el);
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
    return pickElement(
      candidates,
      used,
      (el) => el.tagName !== "SELECT" && !JA.isComboboxInput(el)
    );
  }

  /** Pick the best <select> for a self-identification key. */
  function pickSelect(key, pool, used) {
    const candidates = attributeMatches(JA.SELECT_SELECTORS[key]).concat(
      keywordMatches(pool, JA.KEYWORDS[key], "SELECT")
    );
    return pickElement(candidates, used, (el) => el.tagName === "SELECT");
  }

  /**
   * Find the <option> whose text/value best matches the stored value.
   * (Moved to dom-utils as JA.findOptionForValue so repeatable sections share
   *  it; kept out of here to avoid a duplicate definition.)
   */

  // --- Native field injection --------------------------------------------
  // (injectValue / injectIntoEditable / assignValue / findOptionForValue now
  //  live in dom-utils.js as JA.* so the repeatable-section engine shares them.)

  // --- Custom snippets (feature 4) ---------------------------------------

  /**
   * Inject user-defined key/value snippets AFTER the standard profile keys
   * (feature 4). Each snippet runs the keyword matcher against the field
   * signal, reusing the same `used` set so nothing is filled twice.
   */
  function fillSnippets(profile, pool, used) {
    const snippets = Array.isArray(profile.customSnippets)
      ? profile.customSnippets
      : [];
    let count = 0;

    for (const snippet of snippets) {
      const key = snippet && snippet.key;
      const value = snippet && snippet.value;
      if (!key || !value || typeof value !== "string") continue;

      const keywords = JA.snippetKeywords(key);
      if (keywords.length === 0) continue;

      const el = pickElement(
        keywordMatches(pool, keywords, null),
        used,
        (node) => node.tagName !== "SELECT" && !JA.isComboboxInput(node)
      );
      if (!el) continue;

      try {
        JA.assignValue(el, value);
      } catch (err) {
        continue;
      }
      used.add(el);
      count++;
    }
    return count;
  }

  // --- Orchestration ------------------------------------------------------

  /** Report the outcome back to the popup (may be closed — never throw). */
  function report(payload) {
    try {
      chrome.runtime.sendMessage(
        Object.assign({ type: "JOB_AUTOFILL_RESULT" }, payload)
      );
    } catch (err) {
      /* Popup closed or no receiver — nothing to do. */
    }
  }

  /** Run a full fill pass over the current DOM; returns { filled, used }. */
  function fillEverything(profile) {
    const pool = Array.from(
      document.querySelectorAll(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      )
    ).filter(JA.isFillable);

    const used = new Set();
    let filled = 0;

    for (const key of Object.keys(JA.ATTRIBUTE_SELECTORS)) {
      const value = profile[key];
      if (!value || typeof value !== "string") continue;

      const el = pickField(key, pool, used);
      if (!el) continue;

      try {
        JA.assignValue(el, value);
      } catch (err) {
        continue; // Skip a field the browser refuses to set (e.g. file input).
      }
      used.add(el);
      filled++;
    }

    // Any profile key rendered as a native <select> — self-ID dropdowns,
    // country/state, graduation month/year, etc. pickSelect() only accepts a
    // real SELECT whose label matches the key's keywords.
    for (const key of Object.keys(JA.KEYWORDS)) {
      const value = profile[key];
      if (!value || typeof value !== "string") continue;

      const select = pickSelect(key, pool, used);
      if (!select) continue;

      const option = JA.findOptionForValue(select, value);
      if (!option) continue;

      try {
        JA.selectOption(select, option);
      } catch (err) {
        continue;
      }
      used.add(select);
      filled++;
    }

    // Month/year <select> pairs (graduation date, start date).
    if (JA.fillDateSelects) {
      filled += JA.fillDateSelects(profile, pool, used);
    }

    // Yes/No radio pairs (work authorization, sponsorship) — feature 2.
    if (JA.fillRadios) {
      filled += JA.fillRadios(profile, used);
    }

    // User-defined fuzzy key/value snippets — feature 4.
    filled += fillSnippets(profile, pool, used);

    return { filled, used };
  }

  /** Best human-readable label for a field (aria → label → placeholder → name). */
  function describeField(el) {
    const candidates = [
      el.getAttribute("aria-label"),
      JA.labelTextFor ? JA.labelTextFor(el) : "",
      el.getAttribute("placeholder")
    ];
    for (const candidate of candidates) {
      const text = (candidate || "")
        .replace(/\s+/g, " ")
        .replace(/\s*\*+\s*$/, "") // drop a trailing required marker
        .trim();
      if (text) return text.slice(0, 60);
    }
    const fallback = el.getAttribute("name") || el.id || "";
    const cleaned = fallback.replace(/[_\-]+/g, " ").trim();
    return cleaned ? cleaned.slice(0, 60) : null;
  }

  /** Where to flash for a control: a hidden radio/checkbox lives in a label. */
  function flashTargetFor(el) {
    if (!el || !el.closest) return el;
    if (el.type === "radio" || el.type === "checkbox") {
      return el.closest("label") || el;
    }
    return el;
  }

  /** The question text for a radio group (legend first, then the full signal). */
  function describeRadioGroup(group) {
    const first = group[0];
    const fieldset = first.closest ? first.closest("fieldset") : null;
    const legend = fieldset ? fieldset.querySelector("legend") : null;
    const own = legend ? legend.textContent : "";
    const raw = own || (JA.radioGroupSignal ? JA.radioGroupSignal(group) : "");
    const text = (raw || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\*+\s*$/, "")
      .trim();
    return text ? text.slice(0, 60) : describeField(first);
  }

  /** Is a control actually exposed to the user (or styled away)? */
  function groupVisible(group) {
    return group.some(
      (r) => JA.isVisible(r) || (r.closest && JA.isVisible(r.closest("label")))
    );
  }

  /** Is a radio group marked required? The marker sits on the QUESTION. */
  function groupRequired(group) {
    const first = group[0];
    if (JA.isRequiredField(first)) return true;
    const container =
      first.closest &&
      (first.closest("fieldset") ||
        first.closest('[role="radiogroup"], [role="group"]'));
    if (!container) return false;
    if (container.getAttribute("aria-required") === "true") return true;
    const legend = container.querySelector("legend");
    const text =
      (legend ? legend.textContent : "") +
      " " +
      (container.getAttribute("aria-label") || "");
    return /\*/.test(text);
  }

  /**
   * The fields we could NOT fill, so the popup can tell the user exactly what
   * is left to do by hand. Each entry carries a handle so the popup can ask us
   * to scroll to and flash it, plus whether the form marks it required.
   *
   * Radio groups count as ONE question (never one entry per button), and
   * standalone checkboxes are included — "which of these?" and "I agree" are
   * questions too.
   */
  function collectUnfilled(used) {
    const pool = Array.from(
      document.querySelectorAll(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      )
    );

    const out = [];
    const seen = new Set();

    const push = (label, required, el) => {
      if (!label || seen.has(label)) return false;
      seen.add(label);
      const target = flashTargetFor(el);
      out.push({
        label,
        required: !!required,
        ref: JA.refFor ? JA.refFor(target) : null
      });
      return out.length >= 40;
    };

    // Text / select / contenteditable controls we could not fill.
    for (const el of pool.filter(JA.isFillable)) {
      if (out.length >= 40) break;
      if (used.has(el)) continue;
      if (JA.isComboboxInput && JA.isComboboxInput(el)) continue; // no false noise
      if (JA.isFilled(el)) continue;
      if (push(describeField(el), JA.isRequiredField(el), el)) break;
    }

    // Radio groups: one entry per QUESTION, never one per button.
    if (JA.radioGroups && out.length < 40) {
      for (const group of JA.radioGroups()) {
        if (out.length >= 40) break;
        if (group.some((r) => used.has(r) || r.checked)) continue;
        if (!groupVisible(group)) continue;
        if (push(describeRadioGroup(group), groupRequired(group), group[0])) {
          break;
        }
      }
    }

    // Standalone checkboxes (consent boxes, "currently work here", …).
    if (out.length < 40) {
      for (const el of pool) {
        if (out.length >= 40) break;
        if (el.type !== "checkbox") continue;
        if (used.has(el) || el.checked) continue;
        if (JA.isComboboxInput && JA.isComboboxInput(el)) continue;
        if (!groupVisible([el])) continue;
        if (push(describeField(el), JA.isRequiredField(el), el)) break;
      }
    }

    return out;
  }

  /** Count the form fields present in this frame (diagnostic). */
  function scanCount() {
    return document.querySelectorAll("input, select, textarea").length;
  }

  /**
   * Watch the DOM for up to `timeoutMs` for late-hydrated fields (React SPAs
   * such as Greenhouse/Workday often render the form after script injection)
   * and retry the fill as soon as something matching appears.
   */
  function waitForFields(profile, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let observer = null;
      let lastAttempt = 0;
      let coalesced = null;

      const settle = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        clearTimeout(timer);
        clearTimeout(coalesced);
        resolve(value);
      };

      // React SPAs mutate constantly; unthrottled we would re-run a full fill
      // pass on every one of those mutations. Coalesce to at most one pass per
      // 150 ms and settle the moment something matches.
      const attempt = () => {
        const now = Date.now();
        if (now - lastAttempt < 150) {
          if (!coalesced) {
            coalesced = setTimeout(() => {
              coalesced = null;
              attempt();
            }, 150);
          }
          return;
        }
        lastAttempt = now;
        const result = fillEverything(profile);
        if (result.filled > 0) settle(result);
      };

      observer = new MutationObserver(attempt);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      timer = setTimeout(() => settle(fillEverything(profile)), timeoutMs);
    });
  }

  async function run() {
    let profile;
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      profile = data[STORAGE_KEY];
    } catch (err) {
      report({ status: "error", message: "storage_unavailable" });
      return;
    }

    if (!profile || typeof profile !== "object") {
      report({ status: "empty" });
      return;
    }

    // Run the fill; if nothing matched, the form may still be hydrating (React
    // SPAs such as Greenhouse/Workday render late), so watch the DOM briefly
    // and retry before reporting.
    let result = fillEverything(profile);
    if (result.filled === 0) {
      result = await waitForFields(profile, 2000);
    }
    let filled = result.filled;
    const used = result.used;

    // Custom react-select style dropdowns are not <select> elements.
    filled += await JA.fillCombos(profile);

    // Repeatable sections (Workday "Work Experience", "Education"): reuse +
    // overwrite, and add when needed. Surplus blocks are only REMOVED when the
    // user explicitly asked for it — a resume-parser leftover and an entry they
    // added on purpose are indistinguishable to us.
    let removed = 0;
    let surplus = 0;
    if (JA.fillRepeatableSections) {
      try {
        const sections = await JA.fillRepeatableSections(profile, used, {
          trim: !!profile.replaceHistory
        });
        filled += sections.filled;
        removed = sections.removed;
        surplus = sections.surplus;
      } catch (err) {
        /* a stubborn section must not abort the rest */
      }
    }

    // Resume file: attach the stored resume when we have one, otherwise flag
    // the drop zone with a flashing outline (feature 3).
    let attached = 0;
    let kept = 0;
    let zones = 0;
    let acknowledged = 0;
    let flagged = 0;
    if (JA.attachResumeFile) {
      const files = await JA.attachResumeFile(profile);
      attached = files.attached || 0;
      kept = files.kept || 0;
      zones = files.zones || 0;
      acknowledged = files.acknowledged || 0;
    }
    if (attached === 0 && JA.highlightResumeFiles) {
      flagged = JA.highlightResumeFiles();
    }

    // Reveal the choices for required dropdowns we could not answer, so the
    // user knows what the form actually offers (we never auto-pick).
    let revealed = [];
    if (JA.revealComboOptions) {
      revealed = await JA.revealComboOptions(5);
    }

    const unfilled = collectUnfilled(used).concat(revealed).slice(0, 40);
    const scanned = scanCount();
    console.log(
      "[JobAutofill] frame:", location.href,
      "| form fields:", scanned,
      "| filled:", filled,
      "| resume attached:", attached,
      "| existing attachment kept:", kept,
      "| history blocks removed:", removed,
      "| surplus history blocks left:", surplus,
      "| file drop zones flagged:", flagged,
      "| unfilled:", unfilled.length
    );

    report({
      status: "ok",
      filled,
      attached,
      kept,
      zones,
      acknowledged,
      removed,
      surplus,
      flagged,
      unfilled,
      frame: location.href,
      scanned
    });
  }

  // Always report the outcome and release the re-entrancy guard, even if a
  // portal's DOM throws somewhere unexpected.
  /**
   * The popup asks us to show where an unfilled field is. Elements get a
   * handle while the report is collected, so we can find them again here.
   */
  function locateByRef(ref) {
    const el = JA.findByRef ? JA.findByRef(ref) : null;
    if (!el) return false;
    return JA.locateElement ? JA.locateElement(el) : false;
  }

  if (!window.__jobAutofillLocate) {
    window.__jobAutofillLocate = true;
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== "JOB_AUTOFILL_LOCATE") return;
        locateByRef(message.ref);
      });
    } catch (err) {
      /* messaging unavailable in this frame — the list still works */
    }
  }

  // Exposed so a caller (or a test) can await the REAL completion of the run
  // instead of inferring it from messages.
  window.__jobAutofillRun = run()
    .catch((err) => {
      console.warn("[JobAutofill] failed:", (err && err.message) || err);
      report({ status: "error", message: String((err && err.message) || err) });
    })
    .finally(() => {
      window.__jobAutofillActive = false;
    });
})();
