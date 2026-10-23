// button-yesno.js — Yes/No questions rendered as BUTTONS, not radios.
//
// Some portals (Ashby does this) ask a binary question with two buttons:
//
//   <label for="…">Are you currently legally authorized to work in the US?</label>
//   <div class="…input-yesno">
//     <button type="submit" aria-pressed="false">Yes</button>
//     <button type="submit" aria-pressed="false">No</button>
//   </div>
//
// Every existing path misses this: radios.js wants input[type=radio],
// combobox.js wants react-select, field-fill.js wants a value-taking control,
// and the learners skip `button`/`submit`/`checkbox` outright. So these
// questions are neither filled nor offered for learning.
//
// SAFETY — this is the only place the extension clicks a <button> that may be
// type="submit", so the rules are strict and structural rather than a blocklist:
//
//   1. A button is only ever a candidate as one of exactly TWO buttons that sit
//      in the same container and read as opposite answers to one question. A
//      lone "Submit Application" cannot satisfy that, so it is never eligible.
//   2. The pair must carry a readable QUESTION (its label/legend/aria text).
//      No question -> no anchor -> not a widget -> no click.
//   3. While we click, any form submission is cancelled and the guard is
//      removed immediately after. A pair that happens to live inside a <form>
//      therefore still cannot submit.
//   4. A button whose text looks like an ACTION (submit/apply/send/next…) is
//      never treated as an answer, even inside an otherwise valid pair.
//
// ponytail: rule 3 cancels the `submit` event; a button that calls form.submit()
// directly from its own handler would bypass it. Rules 1-2 are what actually
// keep us off submit controls — 3-4 are depth. Upgrade path: if a portal is ever
// seen doing a direct form.submit(), drop it from the pair on first sight.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** A button that performs an ACTION, never an answer. */
  const ACTION_TEXT =
    /(^| )(submit|apply|send|continue|next|back|cancel|close|save|draft|sign in|log in|login|sign up|register|create account|pay|delete|remove|upload)( |$)/;

  /** Short answer labels we accept as the two sides of a Yes/No pair. */
  const AFFIRMATIVE = /^(yes|y|true|i agree|agree|confirm)$/;
  const NEGATIVE = /^(no|n|false|disagree|decline)$/;

  /** Is this element a button we may consider at all? */
  function isButton(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === "BUTTON") return true;
    return el.getAttribute && el.getAttribute("role") === "button";
  }

  /** Visible to a user: laid out, enabled, not hidden from assistive tech. */
  function isUsable(el) {
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    try {
      if (el.getClientRects().length === 0) return false;
    } catch (err) {
      return false;
    }
    const text = JA.normalize(el.textContent || "");
    return !!text && !ACTION_TEXT.test(text);
  }

  /**
   * The question a pair of buttons answers.
   * Looks for the documented links first (label[for], aria-labelledby), then a
   * preceding heading inside the same field container — which is exactly how
   * Ashby structures it.
   */
  function questionFor(container, firstButton) {
    const bits = [];

    const labelledBy = firstButton && firstButton.getAttribute
      ? firstButton.getAttribute("aria-labelledby")
      : null;
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const node = document.getElementById(id);
        if (node) bits.push(node.textContent);
      });
    }

    if (container) {
      const legend = container.querySelector("legend");
      if (legend) bits.push(legend.textContent);
      const aria = container.getAttribute("aria-label");
      if (aria) bits.push(aria);

      // A label whose `for` points at something in this container, or at
      // nothing at all (a stale pointer to the input it replaced), names it.
      const labels = Array.from(container.querySelectorAll("label"));
      labels.forEach((l) => {
        if (l.querySelector("input, select, textarea, button")) return;
        bits.push(l.textContent);
      });
    }

    // The field wrapper the pair sits in often holds the question as a heading.
    let node = container && container.parentElement;
    for (let up = 0; node && up < 4; up++) {
      const heading = node.querySelector(
        'label, legend, h1, h2, h3, h4, h5, h6, [class*="question"], [class*="label"]'
      );
      if (heading && !heading.querySelector("button")) bits.push(heading.textContent);
      node = node.parentElement;
    }

    for (const bit of bits) {
      const text = String(bit || "").replace(/\s+/g, " ").replace(/\s*\*+\s*$/, "").trim();
      if (text) return text.slice(0, 120);
    }
    return "";
  }

  /** Do these two labels read as opposite answers to one question? */
  function isYesNoPair(texts) {
    if (texts.length !== 2) return false;
    const [a, b] = texts.map((t) => JA.normalize(t));
    if (!a || !b || a === b) return false;
    // Either an explicit Yes/No pair…
    if ((AFFIRMATIVE.test(a) && NEGATIVE.test(b)) ||
        (NEGATIVE.test(a) && AFFIRMATIVE.test(b))) return true;
    // …or two statements that express opposite answers ("I am authorized" /
    // "I am not authorized"). The shared polarity reader decides that.
    if (!JA.answerPolarity || !JA.candidatePolarity) return false;
    const pa = JA.candidatePolarity(a, "");
    const pb = JA.candidatePolarity(b, "");
    return !!pa && !!pb && pa !== pb;
  }

  /**
   * The Yes/No pair `el` belongs to, or null.
   * `el` may be either button; the returned object names both and the question.
   */
  JA.yesNoPairFor = function (el) {
    if (!isButton(el)) return null;

    // Walk out to the container that holds the buttons of this question.
    let container = el.parentElement;
    for (let up = 0; container && up < 5; up++) {
      const buttons = Array.from(container.querySelectorAll('button, [role="button"]'))
        .filter((b) => {
          // Only this question's own buttons: a nested container's are separate.
          const owner = b.parentElement && b.parentElement.closest("div,fieldset");
          return !owner || container.contains(owner);
        });
      if (buttons.length === 2) {
        const usable = buttons.filter(isUsable);
        if (usable.length === 2) {
          const texts = usable.map((b) => (b.textContent || "").trim());
          if (isYesNoPair(texts)) {
            const question = questionFor(container, usable[0]);
            if (!question) return null; // no anchor -> not a widget -> never click
            return { container: container, buttons: usable, texts: texts, question: question };
          }
          return null; // two buttons, but not an answer pair (Save / Submit)
        }
      }
      if (buttons.length > 2) return null; // a toolbar, not a question
      container = container.parentElement;
    }
    return null;
  };

  /** Every recognised Yes/No pair on the page, in document order. */
  JA.yesNoPairs = function (root) {
    const out = [];
    const seen = new Set();
    const buttons = JA.queryAll ? JA.queryAll('button, [role="button"]', root) : [];
    for (const btn of buttons) {
      const pair = JA.yesNoPairFor(btn);
      if (!pair) continue;
      if (seen.has(pair.buttons[0])) continue;
      seen.add(pair.buttons[0]);
      out.push(pair);
    }
    return out;
  };

  /**
   * Press the button in `buttons` that expresses `value`.
   *
   * Reuses the shared negation-safe picker, so a stored "Yes" can never land on
   * an option reading "I am not authorized" — the same guarantee radios get.
   * Returns true only when a button was actually pressed.
   */
  JA.chooseYesNo = function (buttons, value) {
    if (!buttons || buttons.length === 0) return false;
    const texts = buttons.map((b) => (b.textContent || "").trim());

    let chosen = null;
    if (JA.pickPolaritySafe) {
      chosen = JA.pickPolaritySafe(
        buttons.map((b, i) => ({
          el: b,
          text: JA.normalize(texts[i]),
          value: JA.normalize(texts[i])
        })),
        value
      );
    } else if (JA.answerPolarity && JA.candidatePolarity) {
      // Fallback: agree on the expressed answer, or refuse.
      const desired = JA.answerPolarity(value);
      buttons.forEach((b, i) => {
        if (chosen) return;
        if (JA.candidatePolarity(JA.normalize(texts[i]), "") === desired) chosen = b;
      });
    }
    if (!chosen) return false;

    JA.pressButton(chosen);
    return true;
  };

  /**
   * Click a button WITHOUT any chance of submitting a form.
   *
   * This is the guarantee that makes clicking a type="submit" button safe: any
   * `submit` event is cancelled for the duration of the click, then the guard
   * is removed so the page behaves normally afterwards.
   */
  JA.pressButton = function (button) {
    if (!button) return false;

    const kill = (event) => {
      try {
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch (err) {
        /* an event we cannot touch is still cancelled by preventDefault above */
      }
    };

    let guarded = false;
    try {
      document.addEventListener("submit", kill, true);
      guarded = true;
    } catch (err) {
      /* no document guard available — structural rules still apply */
    }

    try {
      if (JA.mouseClick) {
        JA.mouseClick(button);
      } else {
        button.click();
      }
      return true;
    } catch (err) {
      return false;
    } finally {
      if (guarded) {
        try {
          document.removeEventListener("submit", kill, true);
        } catch (err) {
          /* nothing further we can do */
        }
      }
    }
  };

  /**
   * Replay saved Yes/No widgets. Called by the recipe engine, which cannot do
   * this itself: it drives REPEATED blocks, and a Yes/No question is a single
   * pair — sectionBlocks() returns [] for it, so a saved recipe would be skipped
   * in silence and the widget would never fill anything again.
   *
   * A recipe matches only on its OWN host and only when its anchor really
   * appears in a recognised pair, so a stale or foreign definition does nothing
   * rather than clicking at random. Returns { filled, applied }.
   */
  JA.replayYesNoWidget = function (recipes, host, used) {
    const out = { filled: 0, applied: [] };
    const list = Array.isArray(recipes) ? recipes : [];
    if (list.length === 0) return out;
    const pairs = JA.yesNoPairs();
    if (pairs.length === 0) return out;

    for (const recipe of list) {
      if (!recipe || recipe.host !== host) continue;
      const anchor = (recipe.anchor || [])[0];
      if (!anchor) continue;

      // The stored value for this widget's single field. A recipe with no row
      // has nothing to write, so there is nothing to replay.
      const row = (recipe.rows || [])[0] || {};
      const fieldKey = Object.keys(recipe.fields || {})[0];
      if (!fieldKey) continue;
      const cell = row[fieldKey];
      if (!cell) continue;
      // Literal only. A Yes/No pair is remembered from a captured value; a
      // profile-bound cell is resolved elsewhere and never reaches here.
      const value = cell.source === "literal" ? cell.value : "";
      if (typeof value !== "string" || !value.trim()) continue;

      for (const pair of pairs) {
        if (used && pair.buttons.some((b) => used.has(b))) continue;
        if (JA.yesNoAnswer(pair)) continue; // the portal already answered it
        // The anchor must really match this question — the whole safety of a
        // recipe rests on that, exactly as it does for a repeated block.
        const signal = JA.normalize(pair.question);
        if (!JA.matchesKeywords(signal, [anchor])) continue;
        if (!JA.chooseYesNo(pair.buttons, value)) continue;
        if (used) pair.buttons.forEach((b) => used.add(b));
        out.filled++;
        out.applied.push(recipe.host + "|" + anchor);
        break;
      }
    }
    return out;
  };

  /**
   * The answer a pair currently shows, as text ("Yes" / "No" / "").
   *
   * Read the widget's own state; extension markers cannot prove commitment.
   */
  JA.yesNoAnswer = function (pair) {
    if (!pair || !pair.buttons) return "";
    const pressed = pair.buttons.filter(
      (b) => b.getAttribute("aria-pressed") === "true" ||
             b.getAttribute("aria-checked") === "true" ||
             b.getAttribute("data-state") === "checked"
    );
    const first = pressed[0];
    if (first) return String(first.textContent || "").trim();
    return "";
  };

  /**
   * Fill every recognised Yes/No pair whose question matches a profile key or an
   * answer-bank entry. Returns how many were answered. Conservative by design:
   * only an explicit Yes/No-ish value drives a pair, and a pair with no agreeing
   * option is left alone rather than guessed at.
   */
  JA.fillYesNoPairs = function (profile, used, bank) {
    const pairs = JA.yesNoPairs();
    if (pairs.length === 0) return 0;
    let filled = 0;

    const candidates = [];
    for (const key of Object.keys(JA.RADIO_KEYWORDS || {})) {
      const value = profile && profile[key];
      if (typeof value === "string" && value.trim()) {
        candidates.push({ keywords: JA.RADIO_KEYWORDS[key], value: value });
      }
    }
    for (const snippet of (Array.isArray(bank) ? bank : [])) {
      const k = snippet && snippet.key;
      const v = snippet && snippet.value;
      if (!k || typeof v !== "string" || !v.trim()) continue;
      candidates.push({
        keywords: JA.snippetKeywords ? JA.snippetKeywords(k) : [JA.normalize(k)],
        value: v
      });
    }

    for (const pair of pairs) {
      if (used && pair.buttons.some((b) => used.has(b))) continue;
      if (JA.yesNoAnswer(pair)) continue; // already answered
      const signal = JA.normalize(pair.question);
      for (const cand of candidates) {
        if (!JA.matchesKeywords(signal, cand.keywords)) continue;
        if (!JA.chooseYesNo(pair.buttons, cand.value)) continue;
        if (used) pair.buttons.forEach((b) => used.add(b));
        filled++;
        break;
      }
    }
    return filled;
  };
})();
