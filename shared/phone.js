// shared/phone.js — splitting a stored number into country + national parts,
// for the Taleo/Workday-style paired widgets. Attaches to JOB_AUTOFILL_SHARED
// (created by shared/index.js, which is loaded first).
Object.assign(JOB_AUTOFILL_SHARED, {
  // --- Phone numbers, split for Taleo/Workday-style pairs -------------------
  // 1 and 7 are the only single-digit calling codes; the two-digit list is
  // complete; anything else that is not one of those is three digits.

  PHONE_ONE_DIGIT: ["1", "7"],

  PHONE_TWO_DIGIT: [
    "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
    "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56",
    "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84",
    "86", "90", "91", "92", "93", "94", "95", "98"
  ],

  /**
   * Split a stored number into its country and national parts.
   *
   * Returns `{ country, national, digits, full }`. `country` stays "" when the
   * number carries no +prefix and no explicit country was given — we would
   * rather leave the country selector alone than guess and fill it wrongly.
   * The national part keeps the user's OWN grouping (only the country part is
   * cut off), because "555 123 4567" reads better in a form than "5551234567".
   */
  splitPhone: function (phone, country) {
    const full = String(phone == null ? "" : phone).trim();
    const digits = full.replace(/\D/g, "");
    let cc = String(country == null ? "" : country).trim();

    if (!cc && digits) {
      let rest = "";
      if (full.charAt(0) === "+") rest = digits;
      else if (full.indexOf("00") === 0) rest = digits.slice(2); // 0044…
      if (rest) {
        if (this.PHONE_ONE_DIGIT.indexOf(rest.slice(0, 1)) !== -1) {
          cc = rest.slice(0, 1);
        } else if (this.PHONE_TWO_DIGIT.indexOf(rest.slice(0, 2)) !== -1) {
          cc = rest.slice(0, 2);
        } else {
          cc = rest.slice(0, 3);
        }
      }
    }

    let national = full;
    const ccDigits = cc.replace(/\D/g, "");
    if (ccDigits) {
      // Prefer cutting the code out of the ORIGINAL text so the user's spacing
      // survives; fall back to the digit string when it is formatted oddly.
      const after = full.replace(/^\s*(\+|00)/, "");
      if (after.replace(/\D/g, "").indexOf(ccDigits) === 0) {
        national = after.slice(ccDigits.length).replace(/^[\s\-().]+/, "").trim();
      } else if (digits.indexOf(ccDigits) === 0) {
        national = digits.slice(ccDigits.length);
      } else {
        national = digits;
      }
    }

    return { country: cc, national, digits, full };
  },

  /**
   * The country/national parts for a profile, preferring the explicit fields
   * the user filled in and falling back to parsing the single phone field.
   */
  phoneParts: function (profile) {
    const p = profile && typeof profile === "object" ? profile : {};
    const country = typeof p.phoneCountry === "string" ? p.phoneCountry.trim() : "";
    const national = typeof p.phoneNational === "string" ? p.phoneNational.trim() : "";
    if (country && national) {
      return { country, national, digits: national.replace(/\D/g, ""), full: p.phone || "" };
    }
    if (national) {
      const parsed = this.splitPhone(p.phone, country);
      return { country: parsed.country, national, digits: national.replace(/\D/g, ""), full: parsed.full };
    }
    return this.splitPhone(p.phone, country);
  },
});
