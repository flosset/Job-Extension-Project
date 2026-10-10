// dom-events.js — the events framework-driven portals listen for. React/
// Workday ignore a bare .value assignment, so writes are followed by these.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Fire the events that framework-driven portals listen for. */
  JA.dispatchFormEvents = function (el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  /** Shared mouse-event options. */
  JA.mouseOpts = function () {
    return { bubbles: true, cancelable: true, view: window, button: 0 };
  };

  /** Fire a realistic mouse sequence so React widgets react to the click. */
  JA.mouseClick = function (el) {
    const opts = JA.mouseOpts();
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  };

  /** Promise-based delay. */
  JA.sleep = function (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
})();
