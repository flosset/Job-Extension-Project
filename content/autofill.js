// autofill.js — the orchestrator. Injected LAST (see shared/index.js) with the
// rest of the content scripts; it runs the moment it is evaluated.
//
// Reads the profile from chrome.storage.local, runs the fill passes in order,
// and reports the outcome back to the popup. The RULES live next door:
//   matching/   deciding what a field is and which one answers a key
//   controls/   reading and writing one control
//   sections/   repeated groups and replay of a taught widget
//   learning/   capturing answers and widget candidates from what you type
//   page/       what job this page is for
// What is left here is the ORDER of the passes and the result message.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  // Approval is consumed once, including busy/failed runs. A saved preference
  // is never authorization for deleting fields from an application.
  const deleteApproved = window.__jobAutofillDeleteApproval === true;
  delete window.__jobAutofillDeleteApproval;

  // Guard against overlapping runs if the button is clicked twice quickly.
  // We still REPORT, because the popup counts on every injected frame
  // answering — silence would look like a lost frame.
  if (window.__jobAutofillActive) {
    report({ status: "busy" });
    return;
  }
  window.__jobAutofillActive = true;

  // The profile key comes from shared.js (injected as the first content script)
  // with a literal fallback, so a missing shared.js can never break a fill.
  const STORAGE_KEY =
    (window.JOB_AUTOFILL_SHARED &&
      window.JOB_AUTOFILL_SHARED.keys &&
      window.JOB_AUTOFILL_SHARED.keys.profile) ||
    "jobProfile";

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

      const el = JA.matcher.pickElement(
        JA.matcher.keywordMatches(pool, keywords, null),
        used,
        (node) => node.tagName !== "SELECT" && !JA.isComboboxInput(node)
      );
      if (el) {
        try {
          JA.assignValue(el, value);
        } catch (err) {
          continue;
        }
        used.add(el);
        count++;
        continue;
      }

      // The same answer-bank entry may be a native <select> on the next
      // portal ("How did you hear about us"). The option matcher is
      // synonym- and polarity-aware, so it only commits on a real match.
      const select = JA.matcher.pickSelectByKeywords(keywords, pool, used);
      if (select) {
        const option = JA.findOptionForValue(select, value);
        if (option) {
          try {
            JA.selectOption(select, option);
          } catch (err) {
            continue;
          }
          used.add(select);
          count++;
        }
      }
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

  /**
   * Run a full fill pass over the current DOM; returns { filled, used }.
   * `used` (optional) is the run-wide ownership set: pass one in and this pass
   * will neither take a field already claimed by an earlier pass nor let a later
   * one take what it claims.
   */
  function fillEverything(profile, used) {
    // JA.fieldPool walks open shadow roots too, so a web-component field is
    // found exactly like a plain one.
    const pool = JA.fieldPool().filter(JA.isFillable);

    used = used || new Set();
    let filled = 0;

    // Split phone widgets first (Taleo/Workday): the country-code selector and
    // the number box must be claimed BEFORE the single-field pass sees them,
    // otherwise the number box would also be handed the whole "+1 555 1234".
    let splitPhone = false;
    if (JA.fillPhoneParts) {
      const split = JA.fillPhoneParts(profile, pool);
      if (split && split.filled) filled += split.filled;
      splitPhone = !!(split && split.recognised);
      for (const el of (split && split.used) || []) used.add(el);
    }

    for (const key of Object.keys(JA.ATTRIBUTE_SELECTORS)) {
      // The split widget has already spent the phone number. Filling another
      // phone-ish field with the whole value would duplicate it.
      if (key === "phone" && splitPhone) continue;
      const value = profile[key];
      if (!value || typeof value !== "string") continue;

      const el = JA.matcher.pickField(key, pool, used);
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

      const select = JA.matcher.pickSelect(key, pool, used);
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

    // Answer-bank entries rendered as radio questions (review item #4):
    // "willing to relocate?", "how did you hear about us?".
    if (JA.fillSnippetRadios) {
      filled += JA.fillSnippetRadios(profile, used);
    }

    // User-defined fuzzy key/value snippets — feature 4.
    filled += fillSnippets(profile, pool, used);

    return { filled, used };
  }
  /**
   * Watch the DOM for up to `timeoutMs` for late-hydrated fields (React SPAs
   * such as Greenhouse/Workday often render the form after script injection)
   * and retry the fill as soon as something matching appears.
   */
  function waitForFields(profile, timeoutMs, used) {
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
        const result = fillEverything(profile, used);
        if (result.filled > 0) settle(result);
      };

      observer = new MutationObserver(attempt);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      timer = setTimeout(() => settle(fillEverything(profile, used)), timeoutMs);
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

    // Some portals (Lever and many smaller boards) use one "Full Name" field.
    // Derive it from first + last unless the profile sets an explicit override.
    if (!profile.fullName && (profile.firstName || profile.lastName)) {
      profile.fullName = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(" ");
    }

    // Remembered widgets FIRST. A widget the user taught us is more specific
    // knowledge than any generic label match, so it claims its fields before the
    // page-wide passes can mistake them for something else (a "Reference Email"
    // is not the user's email). The whole run shares ONE ownership set, so
    // nothing downstream can write a field this pass already answered.
    const used = new Set();
    let filled = 0;
    let widgets = 0;
    if (JA.fillLearnedWidgets) {
      try {
        const applied = await JA.fillLearnedWidgets(profile, used);
        widgets = (applied && applied.filled) || 0;
        filled += widgets;
      } catch (err) {
        /* a rotten recipe must never break the rest of the fill */
      }
    }

    // Run the fill; if nothing matched, the form may still be hydrating (React
    // SPAs such as Greenhouse/Workday render late), so watch the DOM briefly
    // and retry before reporting.
    let result = fillEverything(profile, used);
    if (result.filled === 0 && widgets === 0) {
      result = await waitForFields(profile, 2000, used);
    }
    filled += result.filled;

    // Custom react-select style dropdowns are not <select> elements.
    filled += await JA.fillCombos(profile, used);

    // Repeatable sections (Workday "Work Experience", "Education"): reuse +
    // overwrite, and add when needed. Surplus blocks are only REMOVED when the
    // user explicitly asked for it — a resume-parser leftover and an entry they
    // added on purpose are indistinguishable to us.
    let removed = 0;
    let surplus = 0;
    let sectionIssues = [];
    if (JA.fillRepeatableSections) {
      try {
        const sections = await JA.fillRepeatableSections(profile, used, {
          trim: deleteApproved
        });
        filled += sections.filled;
        removed = sections.removed;
        surplus = sections.surplus;
        // Sections the fill could not address at all, so the popup can say so
        // instead of leaving the user staring at an empty block they cannot
        // explain.
        sectionIssues = sections.unfilled || [];
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

    // Collected before `revealed` is appended: a revealed dropdown's label is
    // the option list, not a question, so it must never become a learned answer.
    const missing = JA.report.collectUnfilled(used);
    const unfilled = missing.concat(revealed).slice(0, 40);
    const scanned = JA.report.scanCount();
    const iframes = JA.report.iframeCount();
    console.log(
      "[JobAutofill] frame:", location.href,
      "| form fields:", scanned,
      "| filled:", filled,
      "| iframes:", iframes,
      "| resume attached:", attached,
      "| existing attachment kept:", kept,
      "| history blocks removed:", removed,
      "| surplus history blocks left:", surplus,
      "| file drop zones flagged:", flagged,
      "| unfilled:", unfilled.length
    );

    // What this page is an application FOR, for the tracker (top frame only —
    // page-info returns null in a subframe).
    const page = JA.pageInfo ? JA.pageInfo() : null;
    if (page) {
      console.log("[JobAutofill] job:", page.company || page.host, "|", page.role || "(no title)");
    }

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
      sectionIssues,
      page,
      frame: location.href,
      scanned,
      iframes
    });

    // "Learn from what you type": the fields we could NOT answer are exactly
    // the ones the user will fill by hand, so watch those and offer to remember
    // whatever they type.
    if (JA.armLearning) {
      try {
        JA.armLearning(missing);
      } catch (err) {
        /* learning is a bonus — it must never break a fill */
      }
    }

    // "Remember this widget": a repeated group we have no definition for (a
    // References block, a bespoke education widget) gets filled by hand too.
    // What the user types there can teach us the widget for next time.
    if (JA.armWidgetLearning) {
      try {
        JA.armWidgetLearning(used);
      } catch (err) {
        /* a bonus like the answer bank — never allowed to break a fill */
      }
    }
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

  /**
   * Type a generated cover letter into the matching box, on request. Never part
   * of a normal fill: a letter is composed per application and the user asks for
   * it explicitly.
   */
  async function fillCoverLetter(text) {
    if (!text || typeof text !== "string") return false;
    if (!JA.fillFieldByKeywords) return false;
    try {
      return await JA.fillFieldByKeywords(
        document,
        JA.COVER_LETTER_KEYWORDS || ["cover letter"],
        text
      );
    } catch (err) {
      return false;
    }
  }

  if (!window.__jobAutofillMessages) {
    window.__jobAutofillMessages = true;
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message) return;
        if (message.type === "JOB_AUTOFILL_LOCATE") {
          locateByRef(message.ref);
          return;
        }
        if (message.type === "JOB_AUTOFILL_COVER_LETTER") {
          // Answer asynchronously (return true keeps the channel open) so the
          // popup can report what really happened instead of guessing.
          fillCoverLetter(message.text).then((ok) => {
            try {
              sendResponse({ ok: !!ok });
            } catch (err) {
              /* the popup closed before we answered — nothing to do */
            }
          });
          return true;
        }
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