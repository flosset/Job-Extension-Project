// dom-inject.js — WRITING a value into one control: the native prototype
// setter plus bubbling form events, real typing for masked inputs, the right
// <option> for a select, and checkbox/radio clicks a framework will notice.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /**
   * Simulate real typing into a masked / controlled input. Some widgets
   * (Workday's date fields) ignore a programmatic .value and only respond to
   * keyboard-driven input, so we focus, then insert the text via the browser's
   * own insertText, falling back to a per-character key simulation.
   */
  JA.typeIntoElement = function (el, text) {
    const value = String(text == null ? "" : text);
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (err) {
      /* ignore */
    }

    let inserted = false;
    try {
      if (typeof el.select === "function") el.select();
      inserted = document.execCommand("insertText", false, value);
    } catch (err) {
      inserted = false;
    }

    if (!inserted) {
      const proto =
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      const setValue = (v) => {
        if (descriptor && typeof descriptor.set === "function") {
          descriptor.set.call(el, v);
        } else {
          el.value = v;
        }
      };
      setValue("");
      let acc = "";
      for (const ch of value) {
        acc += ch;
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        setValue(acc);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch })
        );
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
      }
    }

    JA.dispatchFormEvents(el);
    return JA.isFilled(el);
  };

  /** Choose an option on a <select> via the native setter + form events. */
  JA.selectOption = function (select, option) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    );
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(select, option.value);
    } else {
      select.value = option.value;
    }
    select.selectedIndex = option.index;
    JA.dispatchFormEvents(select);
  };

  // --- Field injection -----------------------------------------------------

  /** Write into an input/textarea/select via the native setter + form events. */
  JA.injectValue = function (el, value) {
    const adapted = JA.adaptValueForInput(el, value);
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, adapted);
    } else {
      el.value = adapted;
    }
    JA.dispatchFormEvents(el);
  };

  /** Rich-text blocks have no .value — write textContent instead. */
  JA.injectIntoEditable = function (el, value) {
    el.textContent = value;
    JA.dispatchFormEvents(el);
  };

  /** Assign a value to whichever kind of field we were given. */
  JA.assignValue = function (el, value) {
    if (el.isContentEditable) {
      JA.injectIntoEditable(el, value);
    } else {
      JA.injectValue(el, value);
    }
  };

  /** Assign a value to a field, choosing the right <option> for selects. */
  JA.assignFieldValue = function (el, value) {
    if (el.tagName === "SELECT") {
      const option = JA.findOptionForValue(el, value);
      if (!option) return false;
      JA.selectOption(el, option);
      return true;
    }
    JA.assignValue(el, value);
    return true;
  };

  /** Tick/untick a checkbox the way a framework will actually notice. */
  JA.setCheckbox = function (el, checked) {
    if (el.checked !== checked) JA.mouseClick(el);
    if (el.checked !== checked) {
      el.checked = checked;
      JA.dispatchFormEvents(el);
    }
  };
})();
