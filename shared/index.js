// shared/index.js — the cross-context core: storage keys, caps, the injected
// file list, and the text rules every context needs.
//
// Four contexts need the same facts and none of them can import the others:
//
//   * popup.html / options.html load shared/*.js with <script src="...">,
//   * the MV3 service worker (background.js) loads them with importScripts(),
//   * the injected content scripts receive them as the FIRST files of the very
//     list defined below, so learn.js and autofill.js can read the storage keys
//     without hard-coding them,
//   * the test suites load them through tests/_popup-source.js.
//
// This file CREATES the object; the sibling files in shared/ attach their own
// rules to it with Object.assign, so "this" inside a rule still refers to the
// whole object (that is what lets bankCovers call this.keyOf).
//
// Keeping the list here means the popup, the shortcut handler and the injected
// run can never drift apart, and the one dedupe rule that both the content
// script and the UI apply ("is this question already answered?") has exactly
// one definition.
//
// It deliberately uses `var`: importScripts() evaluates it in the worker's
// global scope, where a second load must not be a redeclaration error.
var JOB_AUTOFILL_SHARED = {
  /** Extension pages and the worker share this origin-wide storage lock. */
  withStorageLock: function (task) {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request("job-autofill-storage", task);
    }
    const next = (this.storageWrites || Promise.resolve()).catch(() => {}).then(task);
    this.storageWrites = next;
    return next;
  },
  /** chrome.storage.local keys. */
  keys: {
    profile: "jobProfile",
    learned: "learnedAnswers",
    // The last finished fill, per tab — so the popup can rebuild the "fields
    // left for you" list after it is closed and reopened.
    runs: "lastRuns",
    // Named profiles (a "Frontend" resume vs a "Full-stack" one). The ACTIVE
    // one is mirrored into `profile` above, which is what the injected script
    // reads — so picking a profile never has to touch the fill engine.
    profiles: "jobProfiles",
    // The application log: company / role / URL / date, for duplicate warnings.
    applications: "applications",
    // Widget definitions the user has TAUGHT us — "on this site, that
    // References block maps to these fields". Only ever written on an explicit
    // Save, exactly like a bank entry. Candidates wait under their own key.
    recipes: "jobRecipes",
    widgetCandidates: "widgetCandidates"
  },

  /** How long a whole fill run may take, in ms (popup and worker agree). */
  runDeadlineMs: 15000,

  /** How many tabs' worth of finished runs to remember, and for how long. */
  maxRuns: 5,
  runMaxAgeMs: 6 * 60 * 60 * 1000,

  /** Hard cap on the "answers you typed" list, so it can never grow forever. */
  maxLearned: 20,

  /** Caps on the named profiles and the application log. */
  maxProfiles: 8,
  maxApplications: 500,

  /**
   * Re-pressing Fill within this window is the SAME visit, not a second
   * application. Shared, so the popup and the keyboard shortcut agree.
   */
  duplicateQuietMs: 5 * 60 * 1000,

  /** Caps on remembered widgets and on the pending "remember this widget?" list. */
  maxRecipes: 20,
  maxWidgetCandidates: 10,

  /**
   * The injected files, in load order. The shared/ files come first because
   * everything after them reads this object; autofill.js is last because it is
   * the orchestrator that runs the moment it is evaluated.
   */
  contentScripts: [
    "shared/index.js",
    "shared/phone.js",
    "shared/learned.js",
    "shared/applications.js",
    "shared/widgets.js",
    "shared/profiles.js",
    "content/matching/field-map.js",
    "content/matching/field-signals.js",
    "content/matching/option-match.js",
    "content/matching/field-matcher.js",
    "content/matching/unfilled-report.js",
    "content/controls/shadow-dom.js",
    "content/controls/dom-state.js",
    "content/controls/dom-events.js",
    "content/controls/dom-inject.js",
    "content/controls/locate.js",
    "content/controls/field-fill.js",
    "content/controls/combobox.js",
    "content/controls/dates.js",
    "content/controls/radios.js",
    "content/controls/button-yesno.js",
    "content/controls/phone.js",
    "content/controls/files.js",
    "content/page/page-info.js",
    "content/sections/repeatable.js",
    "content/sections/recipe-replay.js",
    "content/learning/answers.js",
    "content/learning/widget-shape.js",
    "content/learning/widgets.js",
    "content/learning/teach.js",
    "content/autofill.js"
  ],

  /** Escape regex metacharacters (the matcher's own copy lives in dom-utils). */
  escapeRegExp: function (text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  /**
   * Normalize free text to lowercase, space-separated words — the comparison
   * key for a question. Mirrors JA.normalize in content/matching/field-signals.js, which is
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
   * Which profile field, if any, answers the same question as this widget?
   *
   * A widget always WINS over the profile: widgets replay first and claim their
   * fields, so nothing downstream may touch them. That is deliberate — a widget
   * is something the user explicitly taught us, which is more specific than a
   * generic label match. But it is also silent, and it means one answer can live
   * in two places: change the profile and the widget keeps answering with the
   * old value.
   *
   * This reports the overlap so the UI can say so out loud instead of letting
   * the user discover it by being answered wrongly.
   *
   * Only a Yes/No profile field can overlap, because only those are matched
   * against a question's wording (see JA.RADIO_KEYWORDS in the content scripts).
   * A widget for a referee's email overlaps nothing.
   */
  profileKeyForWidget: function (recipe, profile) {
    if (!recipe || !profile || typeof profile !== "object") return "";
    // The learner removes stop words from anchors. Its fingerprint retains
    // the question's wording, so prefer that when identifying the profile key.
    const anchor = this.keyOf(recipe.fingerprint || (recipe.anchor || [])[0] || "");
    if (!anchor) return "";
    // Profile-bound cells read fresh values; only literals can override them.
    if (!(recipe.rows || []).some(row => Object.values(row || {}).some(
      cell => cell && cell.source === "literal" && String(cell.value || "").trim()
    ))) return "";

    // The same wording the fill matches a profile key against. Kept here rather
    // than in the content scripts because this runs in the UI, where those
    // scripts are not loaded — and it must agree with what actually gets
    // written, so the phrases are copied from JA.RADIO_KEYWORDS verbatim.
    const YESNO_PROFILE_KEYS = {
      workAuthorized: [
        "legally authorized to work",
        "authorized to work",
        "work authorization",
        "eligible to work",
        "right to work"
      ],
      sponsorship: [
        "require sponsorship",
        "need sponsorship",
        "visa sponsorship",
        "require a visa",
        "now or in the future require sponsorship"
      ]
    };

    for (const candidate of Object.keys(YESNO_PROFILE_KEYS)) {
      const value = profile[candidate];
      if (typeof value !== "string" || !value.trim()) continue;
      for (const phrase of YESNO_PROFILE_KEYS[candidate]) {
        // The widget answers THIS question, so the question's own wording must
        // appear in it. Comparing the widget against itself would match always.
        const key = this.keyOf(phrase);
        if (key && (key === anchor || this.phraseIn(key, anchor))) return candidate;
      }
    }
    return "";
  },

  /** A short id that is unique enough for a local list. */
  newId: function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
};
