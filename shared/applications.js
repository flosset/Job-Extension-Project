// shared/applications.js — the application log's identity rules and coercion:
// what counts as the same posting, and the ONE logApplication used by both the
// popup and the keyboard shortcut. Attaches to JOB_AUTOFILL_SHARED (created by
// shared/index.js, which is loaded first).
Object.assign(JOB_AUTOFILL_SHARED, {
  // --- Application log ------------------------------------------------------

  /**
   * Parameters we can safely drop when comparing URLs. Boards identify a
   * POSTING with a query parameter — Greenhouse's `?gh_jid=`, Lever's `?jk=`,
   * Workday's requisition params — so stripping the whole query (as this once
   * did) collapsed every posting on a board into one. Only these known
   * disposable trackers are removed; everything else is kept.
   */
  trackingParams: [
    "gclid", "fbclid", "msclkid", "yclid", "dclid", "mc_cid", "mc_eid",
    "igshid", "vero_id", "wt_mc", "trk", "trkcampaign", "trackingid",
    "ref", "referrer", "source", "src", "gh_src", "lever-source",
    "utm", "utm_id", "utm_source", "utm_medium", "utm_campaign",
    "utm_term", "utm_content", "utm_content_id"
  ],

  /** A parameter name we can safely drop when comparing two URLs. */
  isTrackingParam: function (name) {
    const key = String(name || "").toLowerCase();
    return this.trackingParams.indexOf(key) !== -1 || key.indexOf("utm_") === 0;
  },

  /**
   * Canonical URL for comparison: host + path + the MEANINGFUL query, with the
   * known tracking parameters removed and the rest SORTED, so the same posting
   * matches however the link was built.
   */
  urlKey: function (url) {
    const text = String(url || "").trim();
    if (!text) return "";
    let parsed;
    try {
      parsed = new URL(text);
    } catch (err) {
      return text.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
    }
    const base = (parsed.host + parsed.pathname).toLowerCase().replace(/\/+$/, "");
    const keep = [];
    if (parsed.searchParams && typeof parsed.searchParams.forEach === "function") {
      parsed.searchParams.forEach((value, key) => {
        if (!this.isTrackingParam(key)) keep.push(key.toLowerCase() + "=" + value);
      });
    }
    keep.sort();
    return keep.length ? base + "?" + keep.join("&") : base;
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

  /**
   * How strongly `other` matches an application we already logged as `entry`:
   *   "same"     — the same POSTING (its canonical URL matches);
   *   "possible" — the same company AND role, which we cannot confirm is the
   *                same posting (a board posts several roles under one title);
   *   ""         — unrelated.
   * "possible" is only ever a WARNING — never a reason to merge rows or to treat
   * the job as done. The user decides.
   */
  applicationMatch: function (entry, other) {
    const ua = this.urlKey(entry && entry.url);
    const ub = this.urlKey(other && other.url);
    if (ua && ua === ub) return "same";
    const ca = this.companyKey(entry && entry.company);
    const cb = this.companyKey(other && other.company);
    const ra = this.keyOf(entry && entry.role);
    const rb = this.keyOf(other && other.role);
    if (ca && ca === cb && (ra === rb || !ra || !rb)) return "possible";
    return "";
  },

  /**
   * Is `other` the application we already logged as `entry`? True ONLY for a
   * CONFIRMED match: the same posting URL, or the same company+role when we
   * cannot tell the postings apart by URL. Two DIFFERENT posting URLs are
   * different applications even at the same company and role, so a board that
   * posts two "Software Engineer" roles no longer merges them into one.
   */
  sameApplication: function (entry, other) {
    const level = this.applicationMatch(entry, other);
    if (level === "same") return true;
    if (level !== "possible") return false;
    const ua = this.urlKey(entry && entry.url);
    const ub = this.urlKey(other && other.url);
    // Both URLs known and different: the company+role match is only "possible",
    // not enough to call it the same application.
    return !(ua && ub && ua !== ub);
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

  /**
   * A job we have applied to before, or null: { entry, level }. PURE over a
   * supplied list, so the popup (its loaded state) and the worker (freshly-read
   * storage) share ONE rule. "same" wins over "possible"; "possible" always
   * means the same company+role, which may still be two different postings.
   */
  findPreviousApplication: function (page, items) {
    if (!page || !Array.isArray(items)) return null;
    const now = Date.now();
    let possible = null;
    for (const entry of items) {
      if (now - (entry.lastAt || 0) <= this.duplicateQuietMs) continue;
      const level = this.applicationMatch(entry, page);
      if (level === "same") return { entry, level: "same" };
      if (level === "possible" && !possible) possible = { entry, level: "possible" };
    }
    return possible;
  },

  /**
   * Log an application into storage — the ONE implementation, used by BOTH the
   * popup and the keyboard shortcut (the worker has no popup, but must not lose
   * your tracking). Returns { entry, isNew, repeated } | null when the page is
   * not a posting at all.
   */
  logApplication: async function (page) {
    if (!page) return null;
    const company = typeof page.company === "string" ? page.company.trim() : "";
    const role = typeof page.role === "string" ? page.role.trim() : "";
    const url = typeof page.url === "string" ? page.url.trim() : "";
    if (!company && !role && !url) return null;

    let items = [];
    try {
      const data = await chrome.storage.local.get(this.keys.applications);
      items = this.sanitizeApplications(data && data[this.keys.applications]).items;
    } catch (err) {
      items = [];
    }

    const now = Date.now();
    const existing = items.find((entry) =>
      this.sameApplication(entry, { company, role, url })
    );

    let result;
    if (existing) {
      const repeated = now - (existing.lastAt || 0) <= this.duplicateQuietMs;
      if (!repeated) {
        existing.times = (existing.times || 1) + 1;
        existing.lastAt = now;
      }
      if (!existing.company) existing.company = company;
      if (!existing.role) existing.role = role;
      if (!existing.url) existing.url = url;
      result = { entry: existing, isNew: false, repeated };
    } else {
      const entry = {
        id: this.newId(),
        company,
        role,
        url,
        host: typeof page.host === "string" ? page.host : "",
        at: now,
        lastAt: now,
        times: 1,
        status: this.initialApplicationStatus
      };
      items.unshift(entry);
      if (items.length > this.maxApplications) items.length = this.maxApplications;
      result = { entry, isNew: true, repeated: false };
    }

    items.sort((a, b) => b.lastAt - a.lastAt || b.at - a.at);
    try {
      await chrome.storage.local.set({
        [this.keys.applications]: { items: items.slice(0, this.maxApplications) }
      });
    } catch (err) {
      /* the log is a convenience — never let it break a fill */
    }
    return result;
  },

  /**
   * Store a finished run under its tab, pruning expired and extra records. The
   * popup and the keyboard shortcut both call this, so a shortcut fill still
   * leaves the "fields left for you" list for the next popup open.
   */
  saveRunRecord: async function (tabId, results, extra) {
    if (typeof tabId !== "number" || !results) return;
    let runs = {};
    try {
      const data = await chrome.storage.local.get(this.keys.runs);
      const raw = data && data[this.keys.runs];
      runs = raw && typeof raw === "object" ? raw : {};
    } catch (err) {
      runs = {};
    }
    const cutoff = Date.now() - this.runMaxAgeMs;
    const record = {
      tabId,
      at: Date.now(),
      results,
      page: (extra && extra.page) || null,
      duplicate: (extra && extra.duplicate) || null,
      ask: (extra && extra.ask) || null
    };
    const older = [];
    for (const key of Object.keys(runs)) {
      const kept = runs[key];
      if (kept && typeof kept.at === "number" && kept.at >= cutoff && kept.tabId !== tabId) {
        older.push(kept);
      }
    }
    older.sort((a, b) => b.at - a.at);
    const pruned = {};
    for (const kept of [record].concat(older.slice(0, this.maxRuns - 1))) {
      pruned[String(kept.tabId)] = kept;
    }
    try {
      await chrome.storage.local.set({ [this.keys.runs]: pruned });
    } catch (err) {
      /* remembering the list is a convenience — never let it break a fill */
    }
  },
});
