// field-signals.js — reading WHAT a field is: the text a human would read off
// it (label, aria, placeholder, name) and whether a keyword list matches that
// text. Pure text/DOM reading: nothing here writes to a page.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Normalise free text to lowercase, space-separated words. */
  JA.normalize = function (text) {
    return (text || "")
      .toLowerCase()
      .replace(/[_\-.]+/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  /** Escape regex metacharacters in a token. */
  JA.escapeRegExp = function (text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  /** All <label> elements explicitly bound to a field via for/id. */
  JA.labelsFor = function (el) {
    if (!el || !el.id) return [];
    const escaped = String(el.id).replace(/["\\]/g, "\\$&");
    try {
      // Look in the element's OWN root: a field inside a shadow root has its
      // <label> there too, and document.querySelectorAll cannot see it.
      return Array.from(
        JA.rootOf(el).querySelectorAll('label[for="' + escaped + '"]')
      );
    } catch (err) {
      return [];
    }
  };

  /** getElementById within an element's own root (a `for` is root-local). */
  function elementById(id, el) {
    if (!id) return null;
    const root = JA.rootOf(el);
    try {
      if (root.getElementById) return root.getElementById(id);
      const escaped = String(id).replace(/["\\]/g, "\\$&");
      return root.querySelector('[id="' + escaped + '"]');
    } catch (err) {
      return null;
    }
  }

  /** The visible form controls inside a node (how many fields it holds). */
  function fieldsWithin(node) {
    if (!node || !node.querySelectorAll) return [];
    try {
      return Array.from(
        node.querySelectorAll(
          'input:not([type="hidden"]), textarea, select, [contenteditable="true"]'
        )
      );
    } catch (err) {
      return [];
    }
  }

  /** Collect every human-readable hint attached to a field. */
  JA.getSignal = function (el) {
    const bits = [];
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) bits.push(ariaLabel);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const node = elementById(id, el);
        if (node) bits.push(node.textContent);
      });
    }

    JA.labelsFor(el).forEach((label) => bits.push(label.textContent));

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) bits.push(wrappingLabel.textContent);

    // Fallback for portals that put the label BESIDE the field without a usable
    // `for`/id link. react-select (Greenhouse, Lever) does exactly this: it keeps
    // the page's original <label for="school"> and replaces the input that label
    // pointed at with its own, several wrappers deeper.
    //
    // A label is credited to this control only when it demonstrably names it:
    //   * `for` points at this control,
    //   * `for` points at a wrapper that CONTAINS this control (the select shell),
    //   * `for` points at nothing at all (a stale pointer to the input it replaced),
    //   * or it has no `for` and its container holds exactly ONE field — so the
    //     label of a neighbouring row ("First Name" beside "Last Name") is never
    //     lent to the wrong field.
    // A label wrapping its own control is skipped here; it is picked up above.
    let ancestor = el.parentElement;
    for (let level = 0; ancestor && level < 6; level++) {
      let found = false;
      for (const child of ancestor.children) {
        if (child === el || child.tagName !== "LABEL") continue;
        if (child.querySelector("input, select, textarea")) continue;
        const forId = child.getAttribute("for");
        if (forId && forId !== el.id) {
          const target = elementById(forId, el);
          if (target && target !== el && !target.contains(el)) continue;
        } else if (!forId && fieldsWithin(ancestor).length !== 1) {
          continue;
        }
        bits.push(child.textContent);
        found = true;
      }
      if (found) break;
      ancestor = JA.parentOrHost(ancestor);
    }

    bits.push(el.getAttribute("placeholder"));
    bits.push(el.getAttribute("name"));
    bits.push(el.id);
    bits.push(el.getAttribute("autocomplete"));

    return bits.filter(Boolean).join(" ");
  };

  // Compiled keyword patterns, cached so a large form does not rebuild the
  // same RegExp for every candidate field inside nested loops.
  const keywordPatterns = new Map();

  function keywordPattern(keyword) {
    let pattern = keywordPatterns.get(keyword);
    if (!pattern) {
      pattern = new RegExp("(^| )" + keyword + "( |$)");
      keywordPatterns.set(keyword, pattern);
    }
    return pattern;
  }

  /** Does any keyword appear as a whole word in the normalised signal? */
  JA.matchesKeywords = function (signal, keywords) {
    for (const keyword of keywords) {
      if (keywordPattern(keyword).test(signal)) return true;
    }
    return false;
  };

  /** Text of the <label>s / aria-labelledby targets attached to an element. */
  JA.labelTextFor = function (el) {
    const bits = [];
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      by.split(/\s+/).forEach((id) => {
        const node = elementById(id, el);
        if (node) bits.push(node.textContent);
      });
    }
    JA.labelsFor(el).forEach((label) => bits.push(label.textContent));
    const wrapping = el.closest("label");
    if (wrapping) bits.push(wrapping.textContent);
    return bits.filter(Boolean).join(" ");
  };

  /**
   * The *question* text for a radio-button group (not the option labels).
   * Reads the enclosing <fieldset><legend>, a [role="radiogroup"] label, the
   * radios' own aria text, and the nearest shared container's heading.
   */
  JA.radioGroupSignal = function (radios) {
    const first = radios[0];
    const bits = [];

    const fieldset = first.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) bits.push(legend.textContent);
    }

    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      bits.push(group.getAttribute("aria-label"));
      bits.push(JA.labelTextFor(group));
    }

    bits.push(first.getAttribute("aria-label"));
    bits.push(JA.labelTextFor(first));

    // Nearest ancestor that contains the whole group: use its heading/label.
    let node = first.parentElement;
    while (node && !radios.every((r) => node.contains(r))) node = JA.parentOrHost(node);
    if (node) {
      const heading = node.querySelector(
        'legend, h1, h2, h3, h4, h5, h6, .label, [class*="label"]'
      );
      if (heading) bits.push(heading.textContent);
    }

    bits.push(first.getAttribute("name"));
    return bits.filter(Boolean).join(" ");
  };
})();
