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

  /** Caps on remembered widgets and on the pending "remember this widget?" list. */
  maxRecipes: 20,
  maxWidgetCandidates: 10,

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
    "content/widget-learn.js",
    "content/radios.js",
    "content/files.js",
    "content/phone.js",
    "content/page-info.js",
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

  /** A short id that is unique enough for a local list. */
  newId: function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /** Placeholders a template may use (the editor prints this list). */
  templatePlaceholders: [
    "company", "role", "firstName", "fullName",
    "email", "phone", "city", "today"
  ],

  /**
   * Fill {placeholders} in a template.
   *
   * An UNKNOWN placeholder is left exactly as written rather than becoming an
   * empty string: a typo should be visible in the preview, not silently produce
   * a letter with a hole in it that you then send.
   */
  renderTemplate: function (body, values) {
    const map = values && typeof values === "object" ? values : {};
    const names = Object.keys(map);
    return String(body == null ? "" : body).replace(
      /\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}/g,
      (whole, key) => {
        const wanted = key.toLowerCase();
        for (const name of names) {
          if (name.toLowerCase() === wanted) {
            const value = map[name];
            return value == null ? "" : String(value);
          }
        }
        return whole; // unknown placeholder — keep it visible
      }
    );
  },

  // --- Phone numbers, split for Taleo/Workday-style pairs -------------------
  // 1 and 7 are the only single-digit calling codes; the two-digit list is
  // complete; anything else that is not one of those is three digits.

  PHONE_ONE_DIGIT: ["1", "7"],

  PHONE_TWO_DIGIT: [
    "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
    "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56",
    "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84",
    "86", "90", "91", "92", "93", "94", "95", "98"
  ],

  /**
   * Split a stored number into its country and national parts.
   *
   * Returns `{ country, national, digits, full }`. `country` stays "" when the
   * number carries no +prefix and no explicit country was given — we would
   * rather leave the country selector alone than guess and fill it wrongly.
   * The national part keeps the user's OWN grouping (only the country part is
   * cut off), because "555 123 4567" reads better in a form than "5551234567".
   */
  splitPhone: function (phone, country) {
    const full = String(phone == null ? "" : phone).trim();
    const digits = full.replace(/\D/g, "");
    let cc = String(country == null ? "" : country).trim();

    if (!cc && digits) {
      let rest = "";
      if (full.charAt(0) === "+") rest = digits;
      else if (full.indexOf("00") === 0) rest = digits.slice(2); // 0044…
      if (rest) {
        if (this.PHONE_ONE_DIGIT.indexOf(rest.slice(0, 1)) !== -1) {
          cc = rest.slice(0, 1);
        } else if (this.PHONE_TWO_DIGIT.indexOf(rest.slice(0, 2)) !== -1) {
          cc = rest.slice(0, 2);
        } else {
          cc = rest.slice(0, 3);
        }
      }
    }

    let national = full;
    const ccDigits = cc.replace(/\D/g, "");
    if (ccDigits) {
      // Prefer cutting the code out of the ORIGINAL text so the user's spacing
      // survives; fall back to the digit string when it is formatted oddly.
      const after = full.replace(/^\s*(\+|00)/, "");
      if (after.replace(/\D/g, "").indexOf(ccDigits) === 0) {
        national = after.slice(ccDigits.length).replace(/^[\s\-().]+/, "").trim();
      } else if (digits.indexOf(ccDigits) === 0) {
        national = digits.slice(ccDigits.length);
      } else {
        national = digits;
      }
    }

    return { country: cc, national, digits, full };
  },

  /**
   * The country/national parts for a profile, preferring the explicit fields
   * the user filled in and falling back to parsing the single phone field.
   */
  phoneParts: function (profile) {
    const p = profile && typeof profile === "object" ? profile : {};
    const country = typeof p.phoneCountry === "string" ? p.phoneCountry.trim() : "";
    const national = typeof p.phoneNational === "string" ? p.phoneNational.trim() : "";
    if (country && national) {
      return { country, national, digits: national.replace(/\D/g, ""), full: p.phone || "" };
    }
    if (national) {
      const parsed = this.splitPhone(p.phone, country);
      return { country: parsed.country, national, digits: national.replace(/\D/g, ""), full: parsed.full };
    }
    return this.splitPhone(p.phone, country);
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
  },

  // --- Application log ------------------------------------------------------

  /** Canonical URL for comparison: host + path, no query, no trailing slash. */
  urlKey: function (url) {
    const text = String(url || "").trim();
    if (!text) return "";
    try {
      const parsed = new URL(text);
      return (parsed.host + parsed.pathname).toLowerCase().replace(/\/+$/, "");
    } catch (err) {
      return text.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
    }
  },

  /**
   * Company key: legal-form insensitive, so the same employer extracted as
   * "Acme, Inc.", "ACME" and "Acme Ltd" is one company. Only legal/administrative
   * words are dropped — never brand words — so "Acme Technologies" and
   * "Acme Software" stay distinct, as they may well be.
   */
  companyKey: function (text) {
    const key = this.keyOf(text);
    if (!key) return "";
    const drop = [
      "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "plc", "plc",
      "gmbh", "ag", "sa", "sas", "bv", "nv", "oy", "ab", "as", "aps", "pty",
      "corp", "corporation", "co", "company", "holdings", "holding", "group",
      "international", "global", "the"
    ];
    const words = key.split(" ").filter((word) => drop.indexOf(word) === -1);
    return words.join(" ") || key;
  },

  /** What makes two entries "the same application". */
  applicationKey: function (entry) {
    const e = entry && typeof entry === "object" ? entry : {};
    const company = this.companyKey(e.company);
    const role = this.keyOf(e.role);
    // Only trust the composite when the company is known; otherwise fall back
    // to the posting URL rather than collapsing two unknown employers into one.
    if (company && role) return company + "|" + role;
    if (company) return company + "|";
    return this.urlKey(e.url);
  },

  /**
   * Is `entry` the application we already logged as `other`?
   *
   * Same company AND role is the real signal; the same posting URL counts too.
   * A DIFFERENT role at the same company deliberately does not, because that is
   * a different application rather than duplicate work.
   */
  sameApplication: function (entry, other) {
    const a = this.applicationKey(entry);
    const b = this.applicationKey(other);
    if (a && a === b) return true;
    const ua = this.urlKey(entry && entry.url);
    const ub = this.urlKey(other && other.url);
    if (ua && ua === ub) return true;
    const ca = this.companyKey(entry && entry.company);
    const cb = this.companyKey(other && other.company);
    const ra = this.keyOf(entry && entry.role);
    const rb = this.keyOf(other && other.role);
    return !!ca && ca === cb && (!ra || !rb);
  },

  /** The pipeline states an application can be in. */
  applicationStatuses: [
    "saved",
    "in progress",
    "applied",
    "screen",
    "interview",
    "offer",
    "rejected",
    "withdrawn"
  ],

  /**
   * What a freshly logged application is. Pressing Fill means you STARTED an
   * application, not that you submitted it — so it is "in progress" until you
   * say otherwise. Recording "applied" here would make the log lie, and any
   * duplicate warning built on that lie is worse than no warning.
   */
  initialApplicationStatus: "in progress",

  /** States that mean "you have submitted" — past the "Mark applied" point. */
  appliedStatuses: ["applied", "screen", "interview", "offer", "rejected", "withdrawn"],

  /**
   * Coerce stored applications into the exact shape the UI renders, collapsing
   * anything that describes the same application into one row (even if the
   * storage record was hand-edited), newest first.
   */
  sanitizeApplications: function (raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const list = Array.isArray(source)
      ? source
      : Array.isArray(source.items)
      ? source.items
      : [];

    const clip = (value, max) =>
      typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

    const out = [];
    for (const item of list) {
      const e = item && typeof item === "object" ? item : {};
      const company = clip(e.company, 80);
      const role = clip(e.role, 120);
      const url = typeof e.url === "string" ? e.url.trim().slice(0, 500) : "";
      if (!company && !role && !url) continue;

      const entry = {
        id: typeof e.id === "string" && e.id ? e.id : this.newId(),
        company,
        role,
        url,
        host: clip(e.host, 80) || this.urlKey(url).split("/")[0],
        at: typeof e.at === "number" && e.at > 0 ? e.at : 0,
        lastAt: typeof e.lastAt === "number" && e.lastAt > 0 ? e.lastAt : 0,
        times: typeof e.times === "number" && e.times > 0 ? Math.min(e.times, 999) : 1,
        status: this.applicationStatuses.indexOf(e.status) === -1
          ? this.initialApplicationStatus
          : e.status
      };
      if (!entry.lastAt) entry.lastAt = entry.at;

      const already = out.find((existing) => this.sameApplication(existing, entry));
      if (already) {
        already.times += entry.times;
        already.lastAt = Math.max(already.lastAt, entry.lastAt);
        if (!already.company) already.company = entry.company;
        if (!already.role) already.role = entry.role;
        if (!already.url) already.url = entry.url;
        continue;
      }

      out.push(entry);
      if (out.length >= this.maxApplications) break;
    }

    out.sort((a, b) => b.lastAt - a.lastAt || b.at - a.at);
    return { items: out };
  },

  // --- Remembered widgets ---------------------------------------------------
  // A recipe is DATA, replayed by the existing section engine. That engine
  // refuses to mutate anything it cannot verify, so a recipe only ever gets a
  // chance to run when its anchors match a real block. The sanitizer's job is
  // the other half: a hand-edited or half-written record must never produce a
  // recipe that can misfire, so anything unrecognised is dropped outright.

  /** Keyword list -> lowercased, de-duplicated, capped. */
  cleanKeywords: function (value, max) {
    const out = [];
    for (const word of Array.isArray(value) ? value : []) {
      if (typeof word !== "string") continue;
      const text = word.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
      if (!text || out.indexOf(text) !== -1) continue;
      out.push(text);
      if (out.length >= max) break;
    }
    return out;
  },

  /** One line of text, whitespace-collapsed and clipped. */
  cleanShortText: function (value, max) {
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, max)
      : "";
  },

  /**
   * Coerce ONE remembered-widget definition, or return null when it could not
   * be replayed.
   *
   * The shape deliberately MIRRORS JA.SECTIONS (`anchor` / `confirm` / `fields`
   * / `addButton` / `dateFormat`) so the same, already-tested section engine can
   * replay it. `fields` maps a slug -> label keywords (like SECTIONS.fields) and
   * the parallel `values` says where each slug's value comes from on replay.
   */
  cleanRecipe: function (raw) {
    const e = raw && typeof raw === "object" ? raw : {};

    const host = this.cleanShortText(e.host, 80).toLowerCase();
    const anchor = this.cleanKeywords(e.anchor, 12);
    if (!host || anchor.length === 0) return null;

    const rawFields = e.fields && typeof e.fields === "object" ? e.fields : {};
    const fields = {};
    for (const key of Object.keys(rawFields).sort()) {
      if (!/^[a-z][a-z0-9]{0,29}$/i.test(key)) continue;
      const when = this.cleanKeywords(rawFields[key], 12);
      if (when.length === 0) continue;
      fields[key] = when;
      if (Object.keys(fields).length >= 40) break;
    }
    if (Object.keys(fields).length === 0) return null;

    // One ROW per block of the widget — the values that block holds. Two sources,
    // and only two: a PROFILE key (resolved fresh on every run, so it stays
    // correct when the profile changes) or a LITERAL captured value (for data
    // the profile has nowhere to keep — a referee's name, an emergency contact).
    // The engine grows the widget to the number of rows, so a two-reference
    // widget is remembered as two rows, not one.
    const rows = [];
    for (const raw of Array.isArray(e.rows) ? e.rows : []) {
      const r = raw && typeof raw === "object" ? raw : {};
      const row = {};
      for (const key of Object.keys(fields)) {
        const src = r[key] && typeof r[key] === "object" ? r[key] : null;
        if (!src) continue;
        if (src.source === "profile") {
          const profileKey = this.cleanShortText(src.key, 40);
          if (!profileKey) continue;
          row[key] = { source: "profile", key: profileKey };
        } else {
          const literal = this.cleanShortText(src.value, 500);
          if (!literal) continue;
          row[key] = { source: "literal", value: literal };
        }
      }
      if (Object.keys(row).length === 0) continue;
      rows.push(row);
      if (rows.length >= 12) break;
    }
    if (rows.length === 0) return null;

    const confirm = [];
    for (const group of Array.isArray(e.confirm) ? e.confirm : []) {
      const keywords = this.cleanKeywords(group, 12);
      if (keywords.length) confirm.push(keywords);
      if (confirm.length >= 6) break;
    }

    return {
      host,
      name: this.cleanShortText(e.name, 60) || "Saved widget",
      fingerprint: this.cleanShortText(e.fingerprint, 120).toLowerCase(),
      anchor,
      confirm,
      addButton: this.cleanKeywords(e.addButton, 8),
      // How this widget writes dates. "none" = no dates, so nothing is ever
      // reformatted into it.
      dateFormat:
        e.dateFormat === "year" || e.dateFormat === "month-year"
          ? e.dateFormat
          : "none",
      fields,
      rows
    };
  },

  /** Coerce the SAVED widgets (the ones the user accepted). */
  sanitizeRecipes: function (raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const list = Array.isArray(source)
      ? source
      : Array.isArray(source.items)
      ? source.items
      : [];

    const items = [];
    const seen = new Set();
    for (const item of list) {
      const clean = this.cleanRecipe(item);
      if (!clean) continue;
      const e = item && typeof item === "object" ? item : {};
      const id = this.cleanShortText(e.id, 40) || this.newId();
      if (seen.has(id)) continue;
      seen.add(id);
      clean.id = id;
      clean.createdAt = typeof e.createdAt === "number" && e.createdAt > 0 ? e.createdAt : 0;
      clean.lastUsedAt = typeof e.lastUsedAt === "number" && e.lastUsedAt > 0 ? e.lastUsedAt : 0;
      clean.uses = typeof e.uses === "number" && e.uses > 0 ? Math.min(e.uses, 9999) : 0;
      items.push(clean);
      if (items.length >= this.maxRecipes) break;
    }
    return { items };
  },

  /**
   * Coerce the PENDING widgets — what the content script noticed but the user
   * has not accepted. Kept under its own key so a candidate can never fill a
   * live form; only a SINGLE click moves one into `sanitizeRecipes`' list.
   */
  sanitizeWidgetCandidates: function (raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const out = { candidates: [], skipped: [] };

    for (const item of Array.isArray(source.candidates) ? source.candidates : []) {
      const clean = this.cleanRecipe(item);
      if (!clean) continue;
      const e = item && typeof item === "object" ? item : {};
      clean.at = typeof e.at === "number" && e.at > 0 ? e.at : 0;
      out.candidates.push(clean);
      if (out.candidates.length >= this.maxWidgetCandidates) break;
    }

    // Widgets we saw but refused, so the user is told why nothing was offered
    // instead of wondering whether the feature is broken.
    for (const text of Array.isArray(source.skipped) ? source.skipped : []) {
      if (typeof text === "string" && text.trim()) {
        out.skipped.push(text.trim().slice(0, 120));
      }
    }
    return out;
  },

  /** Coerce stored profiles, adopting a v1 single profile on first run. */
  sanitizeProfiles: function (raw, legacyProfile) {
    const source = raw && typeof raw === "object" ? raw : {};
    const list = Array.isArray(source.items) ? source.items : [];
    const items = [];

    for (const item of list) {
      const entry = item && typeof item === "object" ? item : {};
      const profile = entry.profile && typeof entry.profile === "object" ? entry.profile : null;
      if (!profile) continue;
      const id = typeof entry.id === "string" && entry.id ? entry.id : this.newId();
      if (items.some((existing) => existing.id === id)) continue;
      const name = typeof entry.name === "string" ? entry.name.replace(/\s+/g, " ").trim() : "";
      items.push({ id, name: (name || "Untitled").slice(0, 40), profile });
      if (items.length >= this.maxProfiles) break;
    }

    // First run on a v1 install: adopt the profile that is already there, so
    // nothing the user typed is hidden behind a new empty profile.
    if (items.length === 0 && legacyProfile && typeof legacyProfile === "object") {
      items.push({ id: "default", name: "Default", profile: legacyProfile });
    }

    let activeId = typeof source.activeId === "string" ? source.activeId : "";
    if (!items.some((existing) => existing.id === activeId)) {
      activeId = items.length ? items[0].id : "";
    }
    return { activeId, items };
  }
};
