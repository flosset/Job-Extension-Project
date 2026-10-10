// shadow-dom.js — traversal that crosses open shadow roots. A plain
// document.querySelectorAll cannot see into a web component, so every field
// scan in the extension goes through queryAll/fieldPool.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  // --- Open shadow roots (web components) -----------------------------------
  // Newer ATS widgets render their fields inside a shadow root, which a plain
  // document.querySelectorAll() cannot see — the field would look missing. Every
  // field scan in this extension therefore goes through queryAll/fieldPool.
  // A CLOSED shadow root (element.shadowRoot === null) is unreachable by design;
  // no amount of traversal can change that, and nothing here pretends otherwise.

  /** The root a node lives in: its own shadow root, or the document. */
  JA.rootOf = function (el) {
    try {
      const root = el && el.getRootNode ? el.getRootNode() : null;
      return root && root.querySelectorAll ? root : document;
    } catch (err) {
      return document;
    }
  };

  /** The parent, crossing into the shadow HOST when the node is at a root. */
  JA.parentOrHost = function (node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    try {
      const root = node.getRootNode ? node.getRootNode() : null;
      return root && root.host ? root.host : null;
    } catch (err) {
      return null;
    }
  };

  /** Every open shadow root under `root`, breadth-first, each only once. */
  JA.shadowRoots = function (root) {
    const found = [];
    const seen = new Set();
    const queue = [root || document];
    while (queue.length) {
      const scope = queue.shift();
      let elements;
      try {
        elements = scope.querySelectorAll("*");
      } catch (err) {
        continue;
      }
      for (const element of elements) {
        const shadow = element.shadowRoot; // null when the root is closed
        if (!shadow || seen.has(shadow)) continue;
        seen.add(shadow);
        found.push(shadow);
        queue.push(shadow);
      }
    }
    return found;
  };

  /** `root` itself plus every open shadow root beneath it — the scan scopes. */
  JA.scopes = function (root) {
    return [root || document].concat(JA.shadowRoots(root));
  };

  /** querySelectorAll across the scope and every open shadow root in it. */
  JA.queryAll = function (selector, root) {
    const out = [];
    for (const scope of JA.scopes(root)) {
      let nodes;
      try {
        nodes = scope.querySelectorAll(selector);
      } catch (err) {
        continue; // an unparseable selector is simply not a match
      }
      for (const node of nodes) out.push(node);
    }
    return out;
  };

  /** The standard form-field pool, shadow roots included. */
  JA.fieldPool = function (root) {
    return JA.queryAll(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      root
    );
  };
})();
