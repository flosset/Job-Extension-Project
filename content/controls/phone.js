// phone.js — the split phone widget: a country-code selector plus a separate
// national-number input, as Taleo and Workday render it.
//
// Conservative by design. Splitting a phone number wrongly is worse than not
// splitting it, because the user would have to notice and retype it. So we only
// treat a pair as "split" when BOTH halves exist, they sit in the same part of
// the form, and the stored number actually yields a country code. Otherwise the
// normal single-field fill handles it exactly as before.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const SHARED = window.JOB_AUTOFILL_SHARED;

  // "code" is required: a plain "Country" label means the ADDRESS country, and
  // claiming that would fill "+1" into a field the user expects to say "US".
  const COUNTRY_KEYWORDS = [
    "country code", "country phone code", "country calling code", "calling code", "dial code",
    "dialling code", "dialing code", "phone code", "phone prefix",
    "dial prefix", "isd code", "country dial", "country prefix"
  ];

  const NUMBER_KEYWORDS = [
    "phone", "mobile", "telephone", "cell phone", "contact number",
    "phone number", "mobile number", "telephone number", "cell", "tel"
  ];

  const EXTENSION_KEYWORDS = ["extension", "ext", "extn"];

  const signalOf = (el) => JA.normalize(JA.getSignal(el));

  /** A <select> whose options are dial codes ("+1 United States"), unlabelled. */
  function isDialCodeSelect(el) {
    if (el.tagName !== "SELECT") return false;
    const options = Array.from(el.options || []);
    if (options.length < 5) return false;
    let dial = 0;
    let total = 0;
    for (const option of options) {
      const text = (option.textContent || "").trim();
      if (!text) continue;
      total++;
      if (/^(\+|00)\s*\d/.test(text)) dial++;
    }
    return total >= 5 && dial * 2 >= total;
  }

  /** The country-code half of the pair. */
  function isCountryControl(el) {
    // A dial-code <select> is proof on its own, whatever it is called.
    if (isDialCodeSelect(el)) return true;
    if (el.tagName === "SELECT") return false; // a labelled list of names is not it
    if (!JA.matchesKeywords(signalOf(el), COUNTRY_KEYWORDS)) return false;
    const max = Number(el.getAttribute("maxlength"));
    return !max || max <= 6; // "+1" is short; a long box is not a country code
  }

  /** The national-number half of the pair. */
  function isNumberControl(el) {
    if (el.tagName === "SELECT") return false;
    if (isCountryControl(el)) return false;
    const signal = signalOf(el);
    if (JA.matchesKeywords(signal, EXTENSION_KEYWORDS)) return false;
    return JA.matchesKeywords(signal, NUMBER_KEYWORDS);
  }

  /** The nearest ancestor that contains both nodes (crossing shadow hosts). */
  function commonAncestor(a, b) {
    let node = a;
    while (node) {
      if (node.contains && node.contains(b)) return node;
      node = JA.parentOrHost(node);
    }
    return null;
  }

  /** How many steps up from `node` to `ancestor`. */
  function hopsTo(node, ancestor) {
    let steps = 0;
    let walk = node;
    while (walk && walk !== ancestor && steps <= 8) {
      walk = JA.parentOrHost(walk);
      steps++;
    }
    return walk === ancestor ? steps : Infinity;
  }

  /**
   * Are the two halves close enough to be one widget?
   *
   * "An ancestor contains it" is not enough on its own — <body> contains every
   * field on the page — so both must be within three levels of their nearest
   * shared container. That accepts a row, a table cell pair or a small wrapper,
   * and rejects an unrelated "Mobile" box in a different section of the form,
   * which must not be turned into half a phone number.
   */
  function neighbours(node, other) {
    const ancestor = commonAncestor(node, other);
    if (!ancestor) return false;
    return hopsTo(node, ancestor) <= 3 && hopsTo(other, ancestor) <= 3;
  }

  /** Pick the country-code <option> for a code like "+1" or "44". */
  function optionForCode(select, country) {
    const digits = String(country || "").replace(/\D/g, "");
    if (!digits) return null;
    let pattern = null;
    try {
      pattern = new RegExp("(^|[^0-9])" + digits + "($|[^0-9])");
    } catch (err) {
      return null;
    }
    let best = null;
    for (const option of Array.from(select.options || [])) {
      const text = (option.textContent || "").trim();
      const value = String(option.value || "").trim();
      if (!text) continue;
      // Must look like a dial-code entry, not a country name.
      const codeish = /^\+?\d/.test(text) || /\(\+?\d/.test(text) || /^\d+$/.test(value);
      if (!codeish) continue;
      if (!pattern.test(text) && !pattern.test(value)) continue;
      // Shortest match wins: "+1" beats "United States (+1)".
      if (!best || text.length < best.text.length) best = { option, text };
    }
    return best ? best.option : null;
  }

  /**
   * Fill the split pair when the page has one.
   *
   * Returns { filled, used } so the caller can mark both halves as claimed and
   * the normal single-field fill leaves them alone.
   */
  JA.fillPhoneParts = function (profile, pool) {
    const result = { filled: 0, used: [], country: false, national: false, recognised: false };
    const parts = SHARED && SHARED.phoneParts ? SHARED.phoneParts(profile) : null;
    if (!parts || (!parts.digits && !parts.country)) return result;

    const fields = (pool && pool.length ? pool : JA.fieldPool()).filter(
      (el) => JA.isFillable(el)
    );

    const country = fields.find(isCountryControl);
    if (!country) return result; // no country-code control — not a split widget

    // The number half must belong to the SAME part of the form, so an unrelated
    // "Mobile" field elsewhere is never turned into half a phone number.
    const number = fields.find((el) => isNumberControl(el) && neighbours(el, country));
    if (!number) return result;
    result.recognised = true;

    if (parts.country && !JA.isFilled(country) && !JA.isComboboxInput(country)) {
      try {
        if (country.tagName === "SELECT") {
          const option = optionForCode(country, parts.country);
          if (option) {
            JA.selectOption(country, option);
            result.country = true;
          }
        } else {
          // Digits only: a country-code box that takes digits rejects "+1",
          // and every such box accepts "1".
          JA.assignValue(country, parts.country.replace(/\D/g, "") || parts.country);
          result.country = true;
        }
      } catch (err) {
        /* a refusing widget must not abort the fill */
      }
    }

    if (parts.national && !JA.isFilled(number)) {
      try {
        JA.assignValue(number, parts.national);
        result.national = true;
      } catch (err) {
        /* ignore — the field is reported as unfilled instead */
      }
    }

    // The number box is ALWAYS claimed, so the single-field pass can never hand it
    // the whole "+1 555 …" as well. The code box is claimed only when we actually
    // set it: if we could not (no country code known), it must stay in the
    // "left for you" list, or the user would never learn they have to pick it.
    result.used.push(number);
    if (result.country) result.used.push(country);
    if (result.country) result.filled++;
    if (result.national) result.filled++;
    return result;
  };
})();
