// dom-state.js — is this control usable, empty, visible, required? Read-only
// questions about the current state of a field.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** A field is usable only if it is visible and not disabled/read-only. */
  JA.isFillable = function (el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === "INPUT") {
      const type = (el.type || "").toLowerCase();
      if (JA.NON_TEXT_INPUT_TYPES.indexOf(type) !== -1) return false;
    }
    // Hidden via display:none / visibility:hidden / zero layout box.
    if (el.getClientRects().length === 0) return false;
    return true;
  };

  /** Is a <select> still showing its placeholder / nothing chosen? */
  JA.isSelectEmpty = function (el) {
    if (el.selectedIndex < 0) return true;
    const option = el.options[el.selectedIndex];
    if (!option) return true;
    if ((option.value || "").trim() === "") return true;
    // Placeholder-ish labels such as "Please select", "Choose one", "--".
    return /^(select|choose|please|pick)($| )/.test(
      JA.normalize(option.textContent)
    );
  };

  /** Has the element already got content the user typed/chose? */
  JA.isFilled = function (el) {
    if (el.tagName === "SELECT") return !JA.isSelectEmpty(el);
    const text = el.isContentEditable ? el.textContent : el.value;
    return (text || "").trim().length > 0;
  };

  /** Visible to the user (laid out), regardless of whether it takes text. */
  JA.isVisible = function (el) {
    if (!el || el.disabled) return false;
    try {
      return el.getClientRects().length > 0;
    } catch (err) {
      return true;
    }
  };

  /** Is this control marked required (attribute, aria, or a "*" in its label)? */
  JA.isRequiredField = function (el) {
    if (!el) return false;
    if (el.required) return true;
    if (el.getAttribute("aria-required") === "true") return true;
    const text = JA.labelTextFor ? JA.labelTextFor(el) : "";
    if (/\*/.test(text)) return true;
    if (/\*/.test(el.getAttribute("aria-label") || "")) return true;
    return /(^| )required( |$)/.test(JA.normalize(JA.getSignal(el)));
  };
})();
