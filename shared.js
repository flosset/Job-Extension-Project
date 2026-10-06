// shared.js — the ONE place the cross-context constants and rules live.
//
// Four contexts need the same facts and none of them can import the others:
//
//   * popup.html / options.html load this with <script src="shared.js">,
//   * the MV3 service worker (background.js) loads it with importScripts(),
//   * the injected content scripts receive it as the FIRST file of the very
//     list it defines, so learn.js and autofill.js can read the storage keys
//     without hard-coding them,
//   * the test suites load it through tests/_popup-source.js.
//
// Keeping the list here means the popup, the shortcut handler and the injected
// run can never drift apart, and the one dedupe rule that both the content
// script and the UI apply ("is this question already answered?") has exactly
// one definition.
//
// It deliberately uses `var`: importScripts() evaluates it in the worker's
// global scope, where a second load must not be a redeclaration error.
var JOB_AUTOFILL_SHARED = {
  /** chrome.storage.local keys. */
  keys: {
    profile: "jobProfile",
    learned: "learnedAnswers"
  },

  /** How long a whole fill run may take, in ms (popup and worker agree). */
  runDeadlineMs: 15000,

  /** Hard cap on the "answers you typed" list, so it can never grow forever. */
  maxLearned: 20,

  /**
   * The injected files, in load order. `shared.js` is first because everything
   * after it may read this object; autofill.js is last because it is the
   * orchestrator that runs the moment it is evaluated.
   */
  contentScripts: [
    "shared.js",
    "content/field-map.js",
    "content/dom-utils.js",
    "content/combobox.js",
    "content/fill.js",
    "content/dates.js",
    "content/repeatable.js",
    "content/radios.js",
    "content/files.js",
    "content/learn.js",
    "content/autofill.js"
  ],

  /** Escape regex metacharacters (the matcher's own copy lives in dom-utils). */
  escapeRegExp: function (text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  /**
   * Normalize free text to lowercase, space-separated words — the comparison
   * key for a question. Mirrors JA.normalize in content/dom-utils.js, which is
   * what the FILLING matcher uses; a test asserts the two agree so a bank key
   * can never be considered "the same question" by one side and not the other.
   */
  keyOf: function (text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[_\-\.]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  /** Does `needle` occur in `haystack` as a whole phrase (never mid-word)? */
  phraseIn: function (needle, haystack) {
    if (!needle) return false;
    return new RegExp("(^| )" + this.escapeRegExp(needle) + "( |$)").test(haystack);
  },

  /**
   * Is this question already answered by the bank?
   *
   * True when a bank key IS the question, or appears inside it as a whole
   * phrase — a bank entry keyed `salary` already answers "Desired salary". The
   * comparison is on the KEY only, never on the value: a second entry for a
   * question that is already covered would compete for the same field on the
   * page, and which one wins is exactly the unpredictability we refuse to
   * introduce. Re-answering a covered question is a bank edit, not a new entry.
   */
  bankCovers: function (bank, question) {
    const wanted = this.keyOf(question);
    if (!wanted) return false;
    const list = Array.isArray(bank) ? bank : [];
    for (const snippet of list) {
      const key = this.keyOf(snippet && snippet.key);
      if (!key) continue;
      if (key === wanted || this.phraseIn(key, wanted)) return true;
    }
    return false;
  },

  /**
   * Coerce whatever is in storage into the exact shape the UI expects, and
   * enforce "one candidate per question" on the way in — so even a hand-edited
   * or half-written storage record cannot produce two rows for one question.
   */
  sanitizeLearned: function (raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const out = { candidates: [], skipped: [] };

    const incoming = Array.isArray(source.candidates) ? source.candidates : [];
    for (const item of incoming) {
      const entry = item && typeof item === "object" ? item : {};
      const question =
        typeof entry.question === "string" ? entry.question.trim() : "";
      const value = typeof entry.value === "string" ? entry.value : "";
      if (!question || !value) continue;
      const key = this.keyOf(question);
      if (!key || out.candidates.some((c) => this.keyOf(c.question) === key)) {
        continue; // one entry per question, always
      }
      out.candidates.push({
        question: question.slice(0, 120),
        value: value.slice(0, 4000),
        site: typeof entry.site === "string" ? entry.site.slice(0, 120) : "",
        at: typeof entry.at === "number" ? entry.at : 0
      });
      if (out.candidates.length >= this.maxLearned) break;
    }

    const skipped = Array.isArray(source.skipped) ? source.skipped : [];
    for (const text of skipped) {
      if (typeof text === "string" && text.trim()) {
        out.skipped.push(text.trim().slice(0, 120));
      }
    }
    return out;
  }
};
