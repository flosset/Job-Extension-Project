// widget-shape.js — reading the SHAPE of a repeated group: which sibling
// blocks share a signature, where the "add another" control is, and what the
// block is called. Pure DOM reading — no state, no storage, no inference.
//
// learning/widgets.js infers a definition from what you type; this is the
// geometry it reasons over.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SHARED = window.JOB_AUTOFILL_SHARED || {};

  // Wording that grows a repeated group.
  const ADD_WORDS = ["add another", "add more", "add", "new"];
  const DOC_POSITION_FOLLOWING = 4;

  const normalize = (text) =>
    JA.normalize ? JA.normalize(text) : String(text || "").toLowerCase();
  const keyOf = (text) =>
    SHARED.keyOf ? SHARED.keyOf(text) : normalize(text);
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();

  const fieldsIn = (el) =>
    JA.queryAll(
      'input, select, textarea, [contenteditable="true"], [contenteditable=""]',
      el
    );

  /**
   * The label that NAMES a field — never its placeholder or name/id, which are
   * noisy and unstable. An empty result means the field is unreadable, and a
   * widget we cannot label is one we refuse to learn.
   */
  function labelFor(el) {
    const text = JA.labelTextFor ? clean(JA.labelTextFor(el)) : "";
    return text.slice(0, 80);
  }

  /** Shape signature: tag + class names with digits flattened, order-insensitive. */
  function shapeOf(el) {
    const cls = typeof el.className === "string" ? el.className : "";
    const sig = cls
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => name.replace(/\d+/g, "#"))
      .sort()
      .join(".");
    return el.tagName.toLowerCase() + "|" + sig;
  }

  /**
   * The repeated GROUP a field belongs to: walk up until a parent holds >=2
   * siblings of the same shape that each contain fields — that is one block of
   * an add-another widget.
   */
  function groupFor(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 12; depth++) {
      const parent = node.parentElement;
      if (parent) {
        const mine = shapeOf(node);
        const twins = Array.from(parent.children).filter((c) => shapeOf(c) === mine);
        if (twins.length >= 2) {
          const withFields = twins.filter((c) => fieldsIn(c).length > 0);
          if (withFields.length >= 2 && fieldsIn(node).length >= 2) {
            return { block: node, container: parent, blocks: withFields };
          }
        }
      }
      node = parent;
    }
    return null;
  }

  /** The control that grows `container`, if the page has one. */
  function addControlFor(container) {
    const scope = (container && container.parentElement) || container;
    if (!scope) return null;
    const controls = Array.from(
      scope.querySelectorAll('button, [role="button"], a, input[type="button"]')
    );
    for (const el of controls) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const text = normalize(
        el.textContent || el.value || el.getAttribute("aria-label") || ""
      );
      if (!text) continue;
      if (text === "+" || text === "add") return el;
      if (JA.matchesKeywords(text, ADD_WORDS)) return el;
    }
    return null;
  }

  /** The wording of the add control, as replay keywords. */
  function addWordsOf(el) {
    const text = normalize(
      el.textContent || el.value || el.getAttribute("aria-label") || ""
    );
    const words = [];
    for (const word of ADD_WORDS) {
      if (JA.matchesKeywords(text, [word])) words.push(word);
    }
    return words.length ? words : ["add"];
  }

  /** Nearest heading before `container` — the widget's human name. */
  function headingFor(container) {
    const parent = (container && container.parentElement) || document;
    let best = "";
    for (const h of Array.from(
      parent.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')
    )) {
      const text = clean(h.textContent);
      if (!text) continue;
      if (h.compareDocumentPosition(container) & DOC_POSITION_FOLLOWING) best = text;
    }
    return best.slice(0, 60);
  }

  /** Is this widget already handled by a built-in section definition? */
  function coveredByBuiltIn(block) {
    const sections = JA.SECTIONS || {};
    for (const name of Object.keys(sections)) {
      const anchor = (sections[name] && sections[name].anchor) || [];
      if (anchor.length === 0) continue;
      for (const field of fieldsIn(block)) {
        if (JA.matchesKeywords(normalize(JA.getSignal(field)), anchor)) return true;
      }
    }
    return false;
  }

  // Read by learning/widgets.js, and exposed for the suites.
  JA.widgetShape = {
    normalize,
    keyOf,
    clean,
    fieldsIn,
    labelFor,
    shapeOf,
    groupFor,
    addControlFor,
    addWordsOf,
    headingFor,
    coveredByBuiltIn
  };
})();
