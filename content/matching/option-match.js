// option-match.js — matching a STORED VALUE to the choices a control offers.
// Synonym- and polarity-aware, so a stored "Yes" can never land on an option
// reading "I am not authorized". Pure: it decides, it never writes.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  // Answers retain meaningful symbols and Unicode; field-label matching stays unchanged.
  JA.valueKey = function (value) {
    return String(value || "").toLowerCase().replace(/[_\-.]+/g, " ")
      .replace(/[^\p{L}\p{N}+# ]+/gu, " ").replace(/\s+/g, " ").trim();
  };

  /** Expand a stored value into the tokens to look for in option text. */
  JA.expandValueTokens = function (value) {
    const primary = JA.valueKey(value);
    const synonyms = (JA.VALUE_SYNONYMS[primary] || []).slice();

    // US state abbreviations ↔ full names ("TX" ↔ "Texas").
    const abbr = JA.STATE_ABBR || {};
    if (abbr[primary]) {
      synonyms.push(abbr[primary]);
    } else {
      for (const key in abbr) {
        if (abbr[key] === primary) synonyms.push(key);
      }
    }

    return [primary].concat(synonyms).filter(Boolean);
  };

  // Words too generic to identify a field on their own.
  JA.SNIPPET_STOPWORDS = new Set([
    "the", "and", "you", "your", "yours", "why", "for", "with", "have", "has",
    "had", "does", "did", "are", "was", "were", "will", "would", "can",
    "could", "should", "this", "that", "these", "those", "what", "when",
    "where", "which", "while", "how", "much", "many", "about", "from", "into",
    "over", "under", "than", "then", "them", "they", "their", "our", "ours",
    "its", "of", "to", "in", "on", "at", "is", "be", "been", "being", "do",
    "please", "tell", "us", "me", "my", "work", "here", "years", "year"
  ]);

  /**
   * Match keywords for a user answer-bank key.
   *
   * Always includes the whole normalised phrase. Individual words are only
   * emitted for SHORT keys (1–2 words), because a long key's words are too
   * generic on their own: "Why do you want to work here" would otherwise
   * contribute "work", which then matches an unrelated "Work authorization"
   * or "Work experience" field — exactly the wrong-answer failure the rest of
   * the engine works to prevent. A long, specific key must match as a phrase.
   */
  JA.snippetKeywords = function (rawKey) {
    const normalized = JA.normalize(rawKey);
    if (!normalized) return [];
    const words = normalized.split(" ").filter(Boolean);
    const out = [normalized];
    if (words.length <= 2) {
      words.forEach((word) => {
        if (
          word.length >= 4 &&
          !JA.SNIPPET_STOPWORDS.has(word) &&
          out.indexOf(word) === -1
        ) {
          out.push(word);
        }
      });
    }
    return out;
  };

  // --- Answer polarity (negation-safe matching) ----------------------------
  // The dangerous failure this prevents: a stored "Yes" landing on an option
  // reading "I am not authorized to work in the US". Containment alone cannot
  // tell those apart, so we work out the *answer* both sides express — yes,
  // no or decline — and only accept a candidate when the two AGREE. If either
  // side is undecidable we fall back to plain matching, and if nothing agrees
  // we return null (an empty field beats a wrong answer).

  /** Cues that flip an affirmative statement into a negative answer. */
  JA.NEGATION =
    /(^| )(not|n t|never|no longer|dont|don t|do not|does not|did not|am not|is not|are not|will not|would not|cannot|can not|neither|nor|none|unable)( |$)/;

  /** Options that mean "I would rather not answer". */
  JA.DECLINE_PATTERN =
    /(prefer not|decline|do not wish|don t wish|not to disclose|choose not|wish to answer|no answer|not to say|do not want|rather not)/;

  JA.matchesDecline = function (text) {
    return JA.DECLINE_PATTERN.test(text || "");
  };

  /**
   * Which *answer* does a stored value express?
   *   "Yes"                            -> "yes"
   *   "I am a protected veteran"       -> "yes"  (un-negated statement)
   *   "I am not a protected veteran"   -> "no"   (negated statement)
   *   "No, I do not have a disability" -> "no"   (leading answer word)
   *   "Prefer not to say"              -> "decline"
   *   "Male" / "Texas" / "MS"          -> null   (not a yes/no question)
   */
  JA.answerPolarity = function (value) {
    const text = JA.normalize(value);
    if (!text) return null;
    if (JA.matchesDecline(text)) return "decline";
    if (/^(no|n|false)\b/.test(text)) return "no";
    if (/^(yes|y|true)\b/.test(text)) return "yes";
    if (/^(i am not|i do not|i don t|i am no longer|not |never )/.test(text)) {
      return "no";
    }
    if (/^(i am|i do|i have|i was|i served|i currently|i will|i would)/.test(text)) {
      return "yes";
    }
    return null;
  };

  /**
   * Which answer does an option/radio label express? Same rules, read off the
   * label: a leading "Yes"/"No" wins; otherwise a negation cue positioned
   * BEFORE the matched token flips it (so "authorized to work without a
   * sponsor" stays positive while "not authorized to work" does not).
   */
  JA.candidatePolarity = function (text, token) {
    const t = JA.normalize(text);
    if (!t) return null;
    if (JA.matchesDecline(t)) return "decline";
    if (/^(yes|y|true)\b/.test(t)) return "yes";
    if (/^(no|n|false)\b/.test(t)) return "no";
    // A negator positioned BEFORE the matched token flips the statement
    // ("not authorized to work" -> no) while one that follows it does not
    // ("authorized to work without a sponsor" -> yes). A negated *token*
    // itself ("i do not require") is decisive on its own.
    const at = token ? t.indexOf(token) : -1;
    const scope = at > 0 ? t.slice(0, at) : t;
    if (JA.NEGATION.test(scope) || JA.NEGATION.test(token || "")) return "no";
    return "yes";
  };

  /**
   * Negation-safe candidate picker, shared by native <select> options,
   * react-select options and radio buttons.
   * `candidates` = [{ el, text, value }] with normalised text/value.
   *
   * Pass 1/2 — exact equality (strongest signal).
   * Pass 3/4 — whole-word containment, longest token first.
   * Every pass is gated by polarity, so "Yes" can never land on a negated
   * option and an unanswerable question is left blank instead of guessed.
   */
  JA.pickPolaritySafe = function (candidates, value) {
    if (!candidates || candidates.length === 0) return null;
    const tokens = JA.expandValueTokens(value);
    const desired = JA.answerPolarity(value);
    const agrees = (surface, token) =>
      !desired || JA.candidatePolarity(surface, token) === desired;

    for (const token of tokens) {
      for (const c of candidates) {
        if (c.text === token && agrees(c.text, token)) return c.el;
      }
    }
    for (const token of tokens) {
      for (const c of candidates) {
        if (c.value === token && agrees(c.value, token)) return c.el;
      }
    }

    const ordered = tokens.slice().sort((a, b) => b.length - a.length);
    for (const token of ordered) {
      const pattern = new RegExp("(^| )" + JA.escapeRegExp(token) + "( |$)");
      for (const c of candidates) {
        if (!pattern.test(c.text)) continue;
        if (!agrees(c.text, token)) continue;
        return c.el;
      }
    }
    for (const token of ordered) {
      const pattern = new RegExp("(^| )" + JA.escapeRegExp(token) + "( |$)");
      for (const c of candidates) {
        if (!pattern.test(c.value)) continue;
        if (!agrees(c.value, token)) continue;
        return c.el;
      }
    }
    return null;
  };

  /**
   * Find the <option> whose text/value best matches the stored value.
   * Pass 1: exact (normalised) equality. Pass 2: whole-word containment, so
   * "Male" also matches an option reading "Man" — but negation-safe, so "Yes"
   * can never match "Not authorized".
   */
  JA.findOptionForValue = function (select, value) {
    const options = Array.from(select.options).filter(
      (option) => (option.value || "").trim() !== ""
    );
    const candidates = options.map((option) => ({
      el: option,
      text: JA.valueKey(option.textContent),
      value: JA.valueKey(option.value)
    }));
    return JA.pickPolaritySafe(candidates, value);
  };
})();
