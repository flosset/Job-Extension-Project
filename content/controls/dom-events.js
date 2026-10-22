// dom-events.js — the events framework-driven portals listen for. React/
// Workday ignore a bare .value assignment, so writes are followed by these.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /**
   * Fire the events that framework-driven portals listen for.
   *
   * `input` is the one that matters: React reads e.target.value in its synthetic
   * onChange and copies it into state. `change` follows for the older handlers.
   *
   * Deliberately NO `blur`. A real user does not blur a field the instant it is
   * filled, and controlled forms (Ashby/react-hook-form) run their blur
   * validation against state that has not re-rendered yet — so the field is
   * marked "required entry missing" while the text sits visibly in the DOM. It
   * also tripped our own learner, whose capture-phase blur listener
   * (content/learning/answers.js) would treat a scripted fill as the user
   * typing. If a widget genuinely needs focus moved on, the caller does it.
   */
  JA.dispatchFormEvents = function (el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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
