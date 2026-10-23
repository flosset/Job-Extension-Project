// shared/widgets.js — coercion for remembered-widget definitions and their
// pending candidates. Attaches to JOB_AUTOFILL_SHARED (created by
// shared/index.js, which is loaded first).
Object.assign(JOB_AUTOFILL_SHARED, {
  teachLabelAllowed: function (label) {
    return !!label && !/(gender|race|ethnicity|veteran|disabil|social security|\bssn\b|passport|national insurance|birth|password|consent|signature)/i.test(label);
  },

  cleanTaught: function (raw, fields) {
    if (!raw || !["page", "site"].includes(raw.scope)) return null;
    if (typeof raw.path !== "string" || raw.path.length > 2048 ||
        (raw.scope === "page" && !raw.path.startsWith("/"))) return null;
    const controls = {};
    for (const key of Object.keys(fields)) {
      const item = raw.controls && raw.controls[key];
      if (!item || typeof item.label !== "string" || item.label.length > 120 ||
          !this.teachLabelAllowed(item.label) || typeof item.context !== "string" ||
          item.context.length > 600 || !["text", "email", "tel", "url", "number", "date", "month", "search", "textarea", "select", "combo"].includes(item.type)) return null;
      controls[key] = { label: item.label, context: item.context, type: item.type };
    }
    return { scope: raw.scope, path: raw.scope === "page" ? raw.path : "", controls };
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

    const taught = e.taught === undefined ? null : this.cleanTaught(e.taught, fields);
    // A damaged taught mapping must never fall back to keyword-based replay.
    if (e.taught !== undefined && (!taught || rows.length !== 1 ||
        Object.keys(fields).some((key) => !rows[0][key]))) return null;
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
      rows,
      ...(taught ? { taught } : {})
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
});
