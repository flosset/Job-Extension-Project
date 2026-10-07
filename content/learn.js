// learn.js — "learn from what you type".
//
// After a fill, the fields we could NOT answer are exactly the ones the user
// ends up typing in by hand. We watch those fields and, once one of them is
// committed with a value, remember the QUESTION and the answer as a candidate
// for the answer bank.
//
// Nothing is added to the bank automatically. Candidates are stored under their
// own key and only become bank entries when the user accepts them on the popup
// or options page. Four rules keep that completely predictable:
//
//   1. ALREADY COVERED — a question the answer bank already answers is never
//      recorded again, whatever the new answer is. Two bank entries asking the
//      same question would compete for the same field, and whichever one the
//      fill loop happened to reach first would win — unpredictable by
//      construction, and the other entry would be dead weight.
//   2. ONE ENTRY PER QUESTION — the normalized question text IS the identity,
//      so one wording can never produce two candidates.
//   3. AMBIGUOUS IS DROPPED, NEVER OVERWRITTEN — when the same question appears
//      twice with different answers (the same generic label on two fields, or
//      two applications answered differently) we cannot know which one the user
//      meant, so we learn NOTHING from it instead of guessing. It is reported
//      back so the user can see why nothing was offered, rather than silently
//      getting the wrong answer remembered.
//   4. NO SELF-ID, NO FILES — gender / race / veteran / disability status have
//      dedicated, properly-typed profile fields, and file, password and consent
//      controls are not "answers" at all.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SHARED = window.JOB_AUTOFILL_SHARED || {};
  const KEYS = SHARED.keys || {};
  const PROFILE_KEY = KEYS.profile || "jobProfile";
  const LEARNED_KEY = KEYS.learned || "learnedAnswers";
  const FLUSH_MS = 500;

  // Demographics and identity-number questions: never offered as an answer.
  const NEVER_LEARN =
    /(gender|race|ethnicity|veteran|disability|disabled|social security|ssn|date of birth|birth date|birthday)/;

  // Controls that are not free-form answers.
  const SKIP_INPUT_TYPES = [
    "file", "password", "hidden", "checkbox", "submit", "button", "reset",
    "image", "range", "color"
  ];

  let byRef = new Map();      // data-ja-ref        -> the unfilled entry
  const byQuestion = new Map(); // normalized question -> the unfilled entry
  const answers = new Map();    // normalized question -> {question, value, site, at}
  const ambiguous = new Map();  // normalized question -> the readable question
  // (rule 3) so the user is told which question was left alone, not its key.
  // Questions already handed to the user. Once written, a question is only
  // removed from storage by the user (Save or Dismiss), so re-offering it here
  // would resurrect a dismissal — it is never written twice in one page load.
  const written = new Set();
  let bank = [];
  let flushTimer = null;

  const keyOf = (text) =>
    SHARED.keyOf ? SHARED.keyOf(text) : String(text || "").toLowerCase().trim();

  /** Single-line tidy-up: collapse whitespace, drop a trailing required mark. */
  function clean(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\*+\s*$/, "")
      .trim();
  }

  /**
   * A freely-typed answer keeps its line breaks — a pasted paragraph is a
   * first-class answer in this bank, so collapsing its whitespace would quietly
   * corrupt it.
   */
  function cleanValue(text) {
    return String(text || "").replace(/^\s+|\s+$/g, "").slice(0, 4000);
  }

  /** Radios sharing a name — together they are ONE question. */
  function radiosByName(el) {
    if (!el.name) return [el];
    try {
      return Array.from(document.getElementsByName(el.name));
    } catch (err) {
      return [el];
    }
  }

  /** The visible text of a radio option (never its value attribute). */
  function optionLabel(el) {
    const wrapping = el.closest ? el.closest("label") : null;
    if (wrapping) {
      const text = clean(wrapping.textContent);
      if (text) return text.slice(0, 120);
    }
    const label = JA.labelsFor ? JA.labelsFor(el)[0] : null;
    if (label) {
      const text = clean(label.textContent);
      if (text) return text.slice(0, 120);
    }
    return clean(el.value).slice(0, 120);
  }

  /** The QUESTION a control belongs to (the group's wording for a radio set). */
  function questionFor(el) {
    if (el.type === "radio") {
      const signal = JA.radioGroupSignal ? JA.radioGroupSignal(radiosByName(el)) : "";
      const text = clean(signal);
      if (text) return text.slice(0, 60);
    }
    const candidates = [
      el.getAttribute("aria-label"),
      JA.labelTextFor ? JA.labelTextFor(el) : "",
      el.getAttribute("placeholder")
    ];
    for (const candidate of candidates) {
      const text = clean(candidate);
      if (text) return text.slice(0, 60);
    }
    const fallback = clean(
      String(el.getAttribute("name") || el.id || "").replace(/[_-]+/g, " ")
    );
    return fallback ? fallback.slice(0, 60) : "";
  }

  /** What the user actually committed, as text the bank can match later. */
  function answerFor(el) {
    if (el.tagName === "SELECT") {
      if (JA.isSelectEmpty && JA.isSelectEmpty(el)) return "";
      const option = el.options && el.options[el.selectedIndex];
      if (!option) return "";
      // Save the option's VISIBLE text: that is what the bank matches against
      // on the next portal, and what the user actually read when choosing.
      return clean(option.textContent || option.value).slice(0, 500);
    }
    if (el.type === "radio") {
      const checked = radiosByName(el).filter((radio) => radio.checked)[0];
      return checked ? optionLabel(checked) : "";
    }
    const raw = el.isContentEditable ? el.textContent : el.value;
    return cleanValue(raw);
  }

  function safeHost() {
    try {
      return location.hostname || "";
    } catch (err) {
      return "";
    }
  }

  /** Does the bank already answer this question? (rule 1) */
  function covered(question) {
    if (SHARED.bankCovers) return SHARED.bankCovers(bank, question);
    const wanted = keyOf(question);
    return bank.some((snippet) => keyOf(snippet && snippet.key) === wanted);
  }

  /**
   * Which tracked unfilled field does this element belong to?
   * The handle is checked first; a re-rendered field (React replaces the node,
   * taking our attribute with it) is matched by its wording instead.
   */
  function trackedFor(el) {
    let node = el;
    for (let up = 0; node && up < 3; up++) {
      const ref = node.getAttribute && node.getAttribute(JA.REF_ATTR);
      if (ref && byRef.has(ref)) return byRef.get(ref);
      node = node.parentElement;
    }
    const question = keyOf(questionFor(el));
    return question ? byQuestion.get(question) || null : null;
  }

  /** Record one committed answer, applying rules 1-4. */
  function record(el) {
    const entry = trackedFor(el);
    if (!entry) return; // not a field this fill left for the user
    const question = entry.label;
    const key = keyOf(question);
    if (!key) return;
    if (NEVER_LEARN.test(key)) return; // rule 4
    if (ambiguous.has(key)) return; // rule 3 already decided

    const value = answerFor(el);
    if (!value) return; // cleared again — not an answer

    if (covered(question)) return; // rule 1

    const previous = answers.get(key); // rules 2 & 3
    if (!previous) {
      answers.set(key, { question, value, site: safeHost(), at: Date.now() });
    } else if (keyOf(previous.value) !== keyOf(value)) {
      answers.delete(key);
      ambiguous.set(key, question); // keep the READABLE question for the report
    }
    scheduleFlush();
  }

  function onChange(event) {
    const el = event && event.target;
    if (!el || !el.tagName) return;
    if (
      el.tagName === "INPUT" &&
      SKIP_INPUT_TYPES.indexOf((el.type || "").toLowerCase()) !== -1
    ) {
      return;
    }
    record(el);
  }

  /** Load the bank once, so rule 1 needs no storage read per commit. */
  function refreshBank() {
    try {
      const result = chrome.storage.local.get(PROFILE_KEY);
      if (result && typeof result.then === "function") {
        result
          .then((data) => {
            const profile = (data && data[PROFILE_KEY]) || {};
            bank = Array.isArray(profile.customSnippets)
              ? profile.customSnippets
              : [];
          })
          .catch(() => {});
      }
    } catch (err) {
      /* storage unavailable — rule 1 falls back to what we already loaded */
    }
  }

  async function readLearned() {
    try {
      const data = await chrome.storage.local.get(LEARNED_KEY);
      return SHARED.sanitizeLearned
        ? SHARED.sanitizeLearned(data && data[LEARNED_KEY])
        : { candidates: [], skipped: [] };
    } catch (err) {
      return { candidates: [], skipped: [] };
    }
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_MS);
  }

  /**
   * Merge what we saw into the pending list. An entry already waiting for the
   * user keeps its place — a fresh sighting must never overwrite an answer the
   * user has not reviewed yet.
   */
  async function flush() {
    flushTimer = null;
    if (answers.size === 0 && ambiguous.size === 0) return;
    const current = await readLearned();
    const merged = new Map();
    for (const candidate of current.candidates) {
      const key = keyOf(candidate.question);
      if (key) merged.set(key, candidate);
    }
    for (const [key, candidate] of answers) {
      if (!merged.has(key) && !written.has(key) && !covered(candidate.question)) {
        merged.set(key, candidate);
      }
    }
    const limit = SHARED.maxLearned || 20;
    const candidates = Array.from(merged.values()).slice(0, limit);
    for (const key of merged.keys()) written.add(key);
    const skipped = current.skipped.slice();
    for (const question of ambiguous.values()) {
      if (skipped.indexOf(question) === -1) skipped.push(question);
    }
    try {
      await chrome.storage.local.set({
        [LEARNED_KEY]: { candidates, skipped }
      });
    } catch (err) {
      /* quota or storage unavailable — learning is best-effort by design */
    }
  }

  /**
   * Watch the fields this fill left for the user. Called once per fill by
   * autofill.js with the unfilled entries it just reported.
   *
   * ONE watcher per PAGE, never one per fill: a Fill re-injects these scripts,
   * so stacking a second set of listeners would double every sighting and leave
   * the old set holding a previous page's state. The first copy to have
   * something to watch keeps the listeners; later fills only add to what it
   * knows.
   */
  JA.armLearning = function (entries) {
    const watch = (JA.__learnWatch = JA.__learnWatch || {});
    if (watch.update) {
      watch.update(entries);
      return;
    }
    if (!track(entries)) return; // nothing to watch yet — arm when there is

    // Delegated + capture phase: a portal that replaces an input mid-form still
    // reports the change, and we never depend on holding the node ourselves.
    document.addEventListener("change", onChange, true);
    document.addEventListener("blur", onChange, true);
    refreshBank();

    watch.update = (next) => {
      track(next);
      refreshBank();
    };
  };

  /**
   * Remember the questions in `entries`. A question already tracked keeps its
   * place, so a later fill never overwrites one the user has not reviewed.
   * Returns whether there is anything to watch at all.
   */
  function track(entries) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry.label !== "string" || !entry.label) continue;
      const tracked = { label: entry.label, required: !!entry.required };
      if (entry.ref && !byRef.has(entry.ref)) byRef.set(entry.ref, tracked);
      const key = keyOf(entry.label);
      if (key && !byQuestion.has(key)) byQuestion.set(key, tracked);
    }
    return byRef.size > 0 || byQuestion.size > 0;
  }

  // Exposed so a test can await the debounced write instead of guessing at it.
  JA.learningPending = () => flushTimer !== null;
})();
