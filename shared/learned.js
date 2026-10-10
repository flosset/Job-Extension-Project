// shared/learned.js — coercion for the "answers you typed" candidates. Attaches
// to JOB_AUTOFILL_SHARED (created by shared/index.js, which is loaded first).
Object.assign(JOB_AUTOFILL_SHARED, {
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
});
