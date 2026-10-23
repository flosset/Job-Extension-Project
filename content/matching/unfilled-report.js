// unfilled-report.js — what the fill could NOT answer, described the way the
// popup shows it (one entry per radio QUESTION, checkboxes included, each with
// a handle so the popup can ask for it to be highlighted), plus the per-frame
// diagnostics the popup reports.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});

  /** Best human-readable label for a field (aria → label → placeholder → name). */
  function describeField(el) {
    if (el.matches('[role="spinbutton"][id*="dateSection"]')) {
      const question = el.closest('fieldset')?.querySelector('legend')?.textContent.replace(/\*/g, '').trim();
      if (question) return (question + " — " + (el.getAttribute("aria-label") || "Date")).slice(0, 60);
    }
    const candidates = [
      el.getAttribute("aria-label"),
      JA.labelTextFor ? JA.labelTextFor(el) : "",
      el.getAttribute("placeholder")
    ];
    for (const candidate of candidates) {
      const text = (candidate || "")
        .replace(/\s+/g, " ")
        .replace(/\s*[*✱]+\s*$/, "") // drop a trailing required marker
        .trim();
      if (text) return text.slice(0, 60);
    }
    const fallback = el.getAttribute("name") || el.id || "";
    const cleaned = fallback.replace(/[_\-]+/g, " ").trim();
    return cleaned && !/[\[\]{}]|[a-z][A-Z]|\d{4}/.test(fallback) ? cleaned.slice(0, 60) : "Unlabelled question";
  }

  /** Where to flash for a control: a hidden radio/checkbox lives in a label. */
  function flashTargetFor(el) {
    if (!el || !el.closest) return el;
    if (el.type === "radio" || el.type === "checkbox") {
      return el.closest("label") || el;
    }
    return el;
  }

  /** The question text for a radio group (legend first, then the full signal). */
  function describeRadioGroup(group) {
    const first = group[0];
    const fieldset = first.closest ? first.closest("fieldset") : null;
    const legend = fieldset ? fieldset.querySelector("legend") : null;
    const own = legend ? legend.textContent : "";
    const container = first.closest('.application-question, .ashby-application-form-field-entry, [role="radiogroup"]');
    const heading = container?.querySelector('.application-label, .ashby-application-form-question-title, legend');
    const raw = own || heading?.textContent || container?.getAttribute("aria-label") ||
      (container && JA.labelTextFor(container)) || "";
    const text = (raw || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\*+\s*$/, "")
      .trim();
    return text ? text.slice(0, 60) : "Unlabelled question";
  }

  /** Is a control actually exposed to the user (or styled away)? */
  function groupVisible(group) {
    return group.some(
      (r) => JA.isVisible(r) || (r.closest && JA.isVisible(r.closest("label")))
    );
  }

  /** Is a radio group marked required? The marker sits on the QUESTION. */
  function groupRequired(group) {
    const first = group[0];
    if (JA.isRequiredField(first)) return true;
    const container =
      first.closest &&
      (first.closest("fieldset") ||
        first.closest('[role="radiogroup"], [role="group"]'));
    if (!container) return false;
    if (container.getAttribute("aria-required") === "true") return true;
    const legend = container.querySelector("legend");
    const text =
      (legend ? legend.textContent : "") +
      " " +
      (container.getAttribute("aria-label") || "");
    return /\*/.test(text);
  }

  /**
   * The fields we could NOT fill, so the popup can tell the user exactly what
   * is left to do by hand. Each entry carries a handle so the popup can ask us
   * to scroll to and flash it, plus whether the form marks it required.
   *
   * Radio groups count as ONE question (never one entry per button), and
   * standalone checkboxes are included — "which of these?" and "I agree" are
   * questions too.
   */
  function collectUnfilled(used) {
    const pool = JA.fieldPool();

    const out = [];
    const seen = new Set();

    const push = (label, required, el) => {
      if (!label || seen.has(el)) return;
      seen.add(el);
      const target = flashTargetFor(el);
      out.push({
        label,
        required: !!required,
        ref: JA.refFor ? JA.refFor(target) : null
      });
    };

    // Text / select / contenteditable controls we could not answer.
    for (const el of pool.filter(JA.isFillable)) {
      if (JA.isComboboxInput && JA.isComboboxInput(el)) continue; // no false noise
      // A field that is EMPTY now is reported whether or not we claimed it.
      // Skipping everything in `used` (as this used to) hid the one case that
      // matters most: a field we filled and then LOST — a framework re-render,
      // a portal quirk, or our own validation nudge. It was skipped by `used`
      // and never reached the isFilled check, so the popup said "nothing left"
      // while the form would submit that field blank.
      if (JA.isFilled(el) && JA.valueCommitted(el, el.isContentEditable ? el.textContent : el.value)) continue;
      push(describeField(el), JA.isRequiredField(el), el);
    }

    // Custom dropdowns are questions; their search inputs are not answers.
    for (const control of JA.comboControls ? JA.comboControls() : []) {
      const input = JA.comboInput(control);
      const valid = control.getAttribute("aria-invalid") !== "true" && input?.getAttribute("aria-invalid") !== "true";
      if (input?.disabled || control.disabled || control.getAttribute("aria-disabled") === "true" ||
          !JA.isVisible(control) || (valid && JA.comboValueEl(control))) continue;
      const label = JA.comboLabel(control).slice(0, 60);
      push(label || "Unlabelled question", JA.comboRequired(control), control);
    }

    // Radio groups: one entry per QUESTION, never one per button.
    if (JA.radioGroups) {
      for (const group of JA.radioGroups()) {
        if (group.some((r) => r.checked)) continue;
        if (!groupVisible(group)) continue;
        push(describeRadioGroup(group), groupRequired(group), group[0]);
      }
    }

    // Button-based Yes/No questions (Ashby's "...-yesno" widgets): one entry
    // per QUESTION, reported by its readable anchor text. Without this they are
    // invisible to the report — and therefore to the learner, which only watches
    // what the report hands it.
    if (JA.yesNoPairs) {
      for (const pair of JA.yesNoPairs()) {
        if (JA.yesNoAnswer && JA.yesNoAnswer(pair)) continue; // already answered
        if (!groupVisible(pair.buttons)) continue;
        push(pair.question, JA.isRequiredField(pair.buttons[0]), pair.buttons[0]);
      }
    }

    // Standalone checkboxes (consent boxes, "currently work here", …).
    for (const el of pool) {
      if (el.type !== "checkbox") continue;
      if (el.checked) continue;
      if (JA.isComboboxInput && JA.isComboboxInput(el)) continue;
      if (!groupVisible([el])) continue;
      push(describeField(el), JA.isRequiredField(el), el);
    }

    return out.sort((a, b) => Number(b.required) - Number(a.required)).slice(0, 40);
  }

  /** Count the form fields present in this frame (diagnostic). */
  function scanCount() {
    return JA.queryAll("input, select, textarea").length;
  }

  /**
   * Count the iframes in THIS frame that could plausibly hold an application
   * form (only meaningful in the top frame). Reported so the popup can tell the
   * difference between "nothing matched" and "part of this page is in a frame we
   * were not allowed to reach".
   *
   * Deliberately NOT a raw `querySelectorAll("iframe").length`: a page carries
   * hidden plumbing frames — analytics beacons, session/CSRF helpers, a
   * "Powered by" embed — that never load a form and that we were never meant to
   * inject into. Counting those made a fully successful fill look like it had
   * missed a frame, and offered broad host access for nothing. A frame is only
   * interesting if it is rendered and big enough to contain fields.
   */
  function iframeCount() {
    try {
      if (window.top !== window) return 0;
      return Array.from(document.querySelectorAll("iframe")).filter((frame) => {
        try {
          if (frame.hidden) return false;
          if (frame.getAttribute("aria-hidden") === "true") return false;
          const rect = frame.getBoundingClientRect();
          // A 0x0 (or near-zero) frame is a beacon, not a form.
          return rect.width >= 50 && rect.height >= 50;
        } catch (err) {
          return false;
        }
      }).length;
    } catch (err) {
      return 0; // cross-origin window access — this frame is not the top one
    }
  }

  // Read by the orchestrator when it builds the result message.
  JA.report = { collectUnfilled, scanCount, iframeCount };
})();
