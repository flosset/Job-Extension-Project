// shared/profiles.js — coercion for the named profiles, including the v1
// single-profile adoption. Attaches to JOB_AUTOFILL_SHARED (created by
// shared/index.js, which is loaded first).
Object.assign(JOB_AUTOFILL_SHARED, {
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
});
