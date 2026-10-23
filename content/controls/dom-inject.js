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
   * Allow renders between keystrokes so blur commits the widget's current state.
   */
  JA.typeIntoElement = async function (el, text) {
    const value = String(text == null ? "" : text);
    try {
      if (typeof el.focus === "function") el.focus();
      await JA.sleep(20);
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
        el = JA.currentField(el);
        if (!el) return false;
        acc += ch;
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        setValue(acc);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch })
        );
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
        await JA.sleep(20);
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
    if (JA.fillAttempts) JA.fillAttempts.set(select, option.value);
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
    const setValue =
      descriptor && typeof descriptor.set === "function"
        ? (v) => descriptor.set.call(el, v)
        : (v) => {
            el.value = v;
          };

    setValue(adapted);
    JA.dispatchFormEvents(el);

    // A controlled field can clobber our write during the re-render the input
    // event scheduled: React re-renders from its OWN state, and if its onChange
    // has not committed yet it writes back the old (empty) value. Left alone,
    // the DOM then shows empty — or, worse, shows our text while React's state
    // is empty, which is what makes a form claim "required entry missing" for a
    // field the user can see filled.
    //
    // Re-check after the render has had a chance to land and re-assert. Bounded
    // to one retry so a widget that always resets cannot spin.
    //
    // Deliberately NO el.focus() to 'make the component notice': focusing a
    // field BLURS the previously focused one, which fires the very blur event
    // we removed from dispatchFormEvents — on the field we just filled. The
    // re-assert below is what actually settles the value.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (!el.isConnected) return;
        if (el.value !== adapted) {
          setValue(adapted);
          JA.dispatchFormEvents(el);
        }
      });
    }
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
    if (JA.fillAttempts && !(JA.isComboboxInput && JA.isComboboxInput(el))) {
      JA.fillAttempts.set(el, JA.adaptValueForInput(el, value));
    }
  };

  /** Resolve a replaced control only when its stable ID and kind remain unique. */
  JA.currentField = function (el) {
    if (!el || el.isConnected) return el;
    if (!el.id) return null;
    const id = el.id.replace(/["\\]/g, "\\$&");
    const matches = JA.queryAll('[id="' + id + '"]').filter(node => node.tagName === el.tagName && node.type === el.type);
    return matches.length === 1 ? matches[0] : null;
  };

  /** Re-read after framework rendering; a write alone is not a committed answer. */
  JA.valueCommitted = function (el, value) {
    el = JA.currentField(el);
    if (!el || el.getAttribute("aria-invalid") === "true") return false;
    if (el.validity && !el.validity.valid) return false;
    if (el.matches('[role="spinbutton"][id*="dateSection"]') &&
        JA.isVisible(el.closest('fieldset')?.querySelector('[data-automation-id="inputAlert"]'))) return false;
    if (typeof value === "boolean") return el.checked === value;
    const actual = el.isContentEditable ? el.textContent : el.value;
    if (el.getAttribute("role") === "spinbutton" && /^\d+$/.test(actual || "") && /^\d+$/.test(String(value))) {
      return Number(actual) === Number(value);
    }
    return String(actual || "").trim() === String(JA.adaptValueForInput(el, value)).trim() && JA.isFilled(el);
  };

  /** Assign a value to a field, choosing the right <option> for selects. */
  JA.assignFieldValue = function (el, value) {
    if (el.tagName === "SELECT") {
      const option = JA.findOptionForValue(el, value);
      if (!option) return false;
      JA.selectOption(el, option);
      return JA.valueCommitted(el, option.value);
    }
    JA.assignValue(el, value);
    return JA.valueCommitted(el, value);
  };

  /** Tick/untick a checkbox the way a framework will actually notice. */
  JA.setCheckbox = function (el, checked) {
    if (el.checked !== checked) JA.mouseClick(el);
    if (el.checked !== checked) {
      el.checked = checked;
      JA.dispatchFormEvents(el);
    }
    if (JA.fillAttempts) JA.fillAttempts.set(el, checked);
  };
})();
