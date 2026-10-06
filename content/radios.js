// radios.js — fills paired <input type="radio"> Yes/No questions such as
// "Are you legally authorized to work?" and "Will you require sponsorship?".
// The group is matched by its question text, then the radio whose own label
// matches the stored answer is clicked (so the portal registers it).
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** All radio inputs on the page, grouped by their shared `name`. */
  JA.radioGroups = function () {
    const byName = new Map();
    document
      .querySelectorAll('input[type="radio"]')
      .forEach((radio) => {
        const name = radio.name || "__noname_" + (radio.id || "");
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(radio);
      });
    return Array.from(byName.values());
  };

  /** The radio group whose question text matches one of a key's keywords. */
  JA.radioGroupFor = function (key, used) {
    const keywords = JA.RADIO_KEYWORDS[key];
    if (!keywords) return null;
    for (const group of JA.radioGroups()) {
      // Skip groups we already claimed, are disabled, or the user answered.
      if (group.some((r) => used.has(r) || r.disabled || r.checked)) continue;
      const signal = JA.normalize(JA.radioGroupSignal(group));
      if (JA.matchesKeywords(signal, keywords)) return group;
    }
    return null;
  };

  /**
   * The radio in a group whose own label expresses the stored answer.
   * Uses the shared negation-safe picker: "Yes" is never matched onto a radio
   * labelled "I am not authorized to work in the US". Leaving a group blank is
   * always preferable to answering the opposite of what was asked.
   */
  JA.radioOptionFor = function (group, value) {
    // Only a Yes/No-ish answer may drive a radio group; anything else
    // (a gender, a city) is not a question this path can answer.
    if (!JA.answerPolarity(value)) return null;
    const candidates = group.map((radio) => ({
      el: radio,
      text: JA.normalize(JA.getSignal(radio)),
      value: JA.normalize(radio.value)
    }));
    return JA.pickPolaritySafe(candidates, value);
  };

  /** Click a radio (so the portal registers it), then fire form events. */
  JA.selectRadio = function (radio) {
    JA.mouseClick(radio);
    radio.checked = true;
    JA.dispatchFormEvents(radio);
  };

  /** Fill every Yes/No radio group in the profile; returns how many. */
  JA.fillRadios = function (profile, used) {
    used = used || new Set();
    let count = 0;
    for (const key of Object.keys(JA.RADIO_KEYWORDS)) {
      const value = profile[key];
      if (!value || typeof value !== "string") continue;

      const group = JA.radioGroupFor(key, used);
      if (!group) continue;

      const radio = JA.radioOptionFor(group, value);
      if (!radio) continue;

      try {
        JA.selectRadio(radio);
      } catch (err) {
        continue; // Never let one stubborn control abort the run.
      }
      group.forEach((r) => used.add(r));
      count++;
    }
    return count;
  };
  /** The radio group whose question text matches arbitrary answer-bank keywords. */
  JA.radioGroupForKeywords = function (keywords, used) {
    for (const group of JA.radioGroups()) {
      if (group.some((r) => used.has(r) || r.disabled || r.checked)) continue;
      const signal = JA.normalize(JA.radioGroupSignal(group));
      if (JA.matchesKeywords(signal, keywords)) return group;
    }
    return null;
  };

  /**
   * Answer-bank entries rendered as radio questions — "Are you willing to
   * relocate?", "How did you hear about us?". Yes/No answers go through the
   * negation-safe picker; anything else must match a radio's own label EXACTLY
   * (no fuzzy guessing, so a wrong answer can't be produced).
   */
  JA.fillSnippetRadios = function (profile, used) {
    used = used || new Set();
    const snippets = Array.isArray(profile.customSnippets)
      ? profile.customSnippets
      : [];
    let count = 0;

    for (const snippet of snippets) {
      const key = snippet && snippet.key;
      const value = snippet && snippet.value;
      if (!key || !value || typeof value !== "string") continue;

      const keywords = JA.snippetKeywords(key);
      if (!keywords.length) continue;

      const group = JA.radioGroupForKeywords(keywords, used);
      if (!group) continue;

      let radio = JA.radioOptionFor(group, value);
      if (!radio && !JA.answerPolarity(value)) {
        const target = JA.normalize(value);
        radio =
          group.find((r) => {
            const label = JA.normalize(JA.getSignal(r));
            return label === target || JA.normalize(r.value) === target;
          }) || null;
      }
      if (!radio) continue;

      try {
        JA.selectRadio(radio);
      } catch (err) {
        continue;
      }
      group.forEach((r) => used.add(r));
      count++;
    }
    return count;
  };
})();
