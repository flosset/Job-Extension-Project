// locate.js — pointing the user back at a field. The popup and the page are
// different contexts, so a field is tagged with a handle and looked up again,
// then scrolled to and flashed.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  // --- Locating a field from the popup -------------------------------------
  // The popup and the page are different contexts, so the popup can only ask
  // "show me this one" by handle. We tag the element and look it up again.

  JA.REF_ATTR = "data-ja-ref";
  let _jaRefSeq = 0;

  /** Stable handle for an element, so the popup can point back at it. */
  JA.refFor = function (el) {
    if (!el || !el.getAttribute) return null;
    let ref = el.getAttribute(JA.REF_ATTR);
    if (!ref) {
      _jaRefSeq++;
      ref = "ja-" + Date.now().toString(36) + "-" + _jaRefSeq;
      el.setAttribute(JA.REF_ATTR, ref);
    }
    return ref;
  };

  JA.findByRef = function (ref) {
    if (!ref) return null;
    try {
      return JA.queryAll("[" + JA.REF_ATTR + '="' + ref + '"]')[0] || null;
    } catch (err) {
      return null;
    }
  };

  /** Briefly outline an element and scroll it into view, on request. */
  JA.flashElement = function (el, ms) {
    if (!el) return;
    const STYLE_ID = "__jobAutofillFlashStyle";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        "@keyframes jaFlash {",
        "  0%, 100% { outline-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.45); }",
        "  50%      { outline-color: #fde68a; box-shadow: 0 0 0 8px rgba(253, 230, 138, 0.55); }",
        "}",
        "[data-ja-flash] {",
        "  outline: 3px solid #f59e0b !important;",
        "  outline-offset: 2px !important;",
        "  border-radius: 6px !important;",
        "  animation: jaFlash 1s ease-in-out 3 !important;",
        "}"
      ].join("\n");
      (document.head || document.documentElement).appendChild(style);
    }
    el.setAttribute("data-ja-flash", "1");
    setTimeout(() => el.removeAttribute("data-ja-flash"), ms || 3200);
  };

  /** Scroll to an element and flash it (used by the popup's field list). */
  JA.locateElement = function (el) {
    if (!el) return false;
    try {
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } catch (err) {
      /* older engines: no options object */
    }
    try {
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    } catch (err) {
      /* a non-focusable wrapper is fine */
    }
    JA.flashElement(el);
    return true;
  };
})();
