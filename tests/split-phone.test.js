// split-phone.test.js — split phone fields (a country-code control + a separate number).
//
// The rule under test is deliberately conservative: a pair is only treated as a
// split widget when BOTH halves exist, they sit in the same part of the form,
// and the stored number actually yields a country code. Everything else keeps
// working exactly as it did — one field, the whole number.
"use strict";
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("./_popup-source");

const SITE = "https://jobs.example.com/apply";

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(58)}: ${detail === undefined ? "" : String(detail) + " "}${
      cond ? "PASS" : "FAIL"
    }`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run the REAL content scripts against `html` with `profile`. */
async function pageWith(html, profile) {
  const store = { jobProfile: profile };
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: SITE });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  const reports = [];
  w.chrome = {
    storage: {
      local: {
        get: async (key) =>
          typeof key === "string" ? { [key]: store[key] } : Object.assign({}, store),
        set: async () => {}
      }
    },
    runtime: {
      sendMessage: (message) => reports.push(message),
      onMessage: { addListener: () => {} }
    }
  };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun;
  await sleep(30);
  const report = reports.find((m) => m.type === "JOB_AUTOFILL_RESULT") || {};
  return { w, d: w.document, report, JA: w.__JobAutofill, store };
}

const val = (p, id) => {
  const el = p.d.getElementById(id);
  return el ? el.value : "(missing)";
};
const unfilled = (p) => (p.report.unfilled || []).map((u) => u.label).join(" | ");

/** The dial-code options a phone picker offers. */
const DIAL_OPTIONS = `
  <option value="">Select…</option>
  <option value="+1">+1 United States</option>
  <option value="+44">+44 United Kingdom</option>
  <option value="+49">+49 Germany</option>
  <option value="+33">+33 France</option>
  <option value="+61">+61 Australia</option>
  <option value="+81">+81 Japan</option>`;

(async () => {
  // ---- A. the Taleo shape: a dial-code <select> beside the number ---------
  const a = await pageWith(
    `<form>
       <div class="row">
         <label for="cc">Country Code</label>
         <select id="cc" name="phone_country_code">${DIAL_OPTIONS}</select>
         <label for="ph">Phone Number</label>
         <input id="ph" name="phone_number" type="tel" />
       </div>
     </form>`,
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t("A: the country code is selected", val(a, "cc") === "+1", val(a, "cc"));
  t("A: the number is the NATIONAL part only", val(a, "ph") === "555 123 4567", val(a, "ph"));
  t("A: the full number is not typed anywhere", val(a, "ph").indexOf("+1") === -1);
  t("A: both halves count as filled", a.report.filled === 2, a.report.filled);
  t("A: nothing is left unfilled", (a.report.unfilled || []).length === 0, unfilled(a));

  // ---- B. an UNLABELLED dial-code picker is still recognised --------------
  // The select has no label and a meaningless name; its OPTIONS are the proof.
  const b = await pageWith(
    `<form><div>
       <select id="cc" name="x1">${DIAL_OPTIONS}</select>
       <input id="ph" name="phone" type="tel" />
     </div></form>`,
    { firstName: "Jane", phone: "+44 7911 123456" }
  );
  t("B: the unlabelled picker is detected", val(b, "cc") === "+44", val(b, "cc"));
  t("B: the number keeps the user's grouping", val(b, "ph") === "7911 123456", val(b, "ph"));
  t("B: both halves are filled", b.report.filled === 2, b.report.filled);

  // ---- C. an ADDRESS country select is never hijacked --------------------
  const c = await pageWith(
    `<form>
       <label for="country">Country</label>
       <select id="country" name="country">
         <option value="">Select…</option>
         <option value="United States">United States</option>
         <option value="United Kingdom">United Kingdom</option>
         <option value="Germany">Germany</option>
         <option value="France">France</option>
         <option value="Australia">Australia</option>
         <option value="Japan">Japan</option>
       </select>
       <label for="ph">Phone</label>
       <input id="ph" name="phone" type="tel" />
     </form>`,
    { firstName: "Jane", phone: "+1 555 123 4567", country: "United States" }
  );
  t("C: the address country is filled by NAME", val(c, "country") === "United States", val(c, "country"));
  t("C: it was not given a dial code", val(c, "country").indexOf("+") === -1);
  t("C: the phone gets the WHOLE number", val(c, "ph") === "+1 555 123 4567", val(c, "ph"));

  // ---- D. a country-code TEXT box gets digits only ------------------------
  const d = await pageWith(
    `<form><div>
       <label for="cc">Country Code</label>
       <input id="cc" name="country_code" maxlength="4" />
       <label for="ph">Mobile Number</label>
       <input id="ph" name="mobile_number" type="tel" />
     </div></form>`,
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t("D: the code box gets digits, not '+1'", val(d, "cc") === "1", val(d, "cc"));
  t("D: and the number is national", val(d, "ph") === "555 123 4567", val(d, "ph"));

  // ---- E. no country control: unchanged behaviour -------------------------
  const e = await pageWith(
    `<form><label for="ph">Phone</label><input id="ph" name="phone" type="tel" /></form>`,
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t("E: a lone phone field still gets the whole number", val(e, "ph") === "+1 555 123 4567", val(e, "ph"));
  t("E: and it is not split", e.report.filled === 1, e.report.filled);

  // ---- F. a far-away number box is not half a phone number ----------------
  const f = await pageWith(
    `<form id="f">
       <div id="a"><select id="cc" name="phone_country_code">${DIAL_OPTIONS}</select></div>
       <div id="b"><div><div><div>
         <label for="mobile">Mobile</label><input id="mobile" name="mobile" type="tel" />
       </div></div></div></div>
     </form>`,
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t("F: the distant field is left whole", val(f, "mobile") === "+1 555 123 4567", val(f, "mobile"));
  t("F: and the picker is left alone", val(f, "cc") === "", JSON.stringify(val(f, "cc")));

  // ---- G. the extension box is never touched ------------------------------
  const g = await pageWith(
    `<form><div>
       <label for="cc">Country Code</label>
       <input id="cc" name="country_code" maxlength="4" />
       <label for="ph">Phone Number</label>
       <input id="ph" name="phone_number" type="tel" />
       <label for="ext">Extension</label>
       <input id="ext" name="phone_ext" />
     </div></form>`,
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t("G: the extension box is untouched", val(g, "ext") === "", JSON.stringify(val(g, "ext")));
  t("G: the pair is still filled", val(g, "cc") === "1" && val(g, "ph") === "555 123 4567");
  t("G: the extension is listed as left for the user", /Extension/.test(unfilled(g)), unfilled(g));

  // ---- H. explicit country/national fields win ----------------------------
  const h = await pageWith(
    `<form><div>
       <label for="cc">Country Code</label>
       <input id="cc" name="country_code" maxlength="4" />
       <label for="ph">Phone Number</label>
       <input id="ph" name="phone_number" type="tel" />
     </div></form>`,
    { firstName: "Jane", phone: "+1 555 123 4567", phoneCountry: "+44", phoneNational: "7911 123456" }
  );
  t("H: the explicit code is used", val(h, "cc") === "44", val(h, "cc"));
  t("H: the explicit number is used", val(h, "ph") === "7911 123456", val(h, "ph"));

  // ---- I. a number with no +prefix ----------------------------------------
  const i = await pageWith(
    `<form><div>
       <label for="cc">Country Code</label>
       <input id="cc" name="country_code" maxlength="4" />
       <label for="ph">Phone Number</label>
       <input id="ph" name="phone_number" type="tel" />
     </div></form>`,
    { firstName: "Jane", phone: "(555) 123-4567" }
  );
  t("I: the national part is still filled", val(i, "ph") === "(555) 123-4567", val(i, "ph"));
  t(
    "I: but no code is invented for the country box",
    val(i, "cc") === "",
    JSON.stringify(val(i, "cc"))
  );
  t(
    "I: the country box is offered as left for the user",
    /Country Code/.test(unfilled(i)),
    unfilled(i)
  );

  // ---- J. the parsing rules themselves ------------------------------------
  const S = require("./_popup-source").SHARED;
  t("J: +1 is one digit", S.splitPhone("+1 555 123 4567").country === "1");
  t("J: +44 is two", S.splitPhone("+44 7911 123456").country === "44");
  t("J: +351 is three", S.splitPhone("+351 912 345 678").country === "351");
  t("J: +7 is one", S.splitPhone("+7 912 345 6789").country === "7");
  t("J: 00-prefixed works", S.splitPhone("0044 7911 123456").country === "44");
  t("J: no prefix, no country", S.splitPhone("555 123 4567").country === "");
  t("J: an explicit country wins", S.splitPhone("+1 555 123 4567", "+44").country === "+44");
  t("J: the national part drops the code", S.splitPhone("+1 555 123 4567").national === "555 123 4567");
  t(
    "J: an explicit pair is used as given",
    S.phoneParts({ phone: "+1 555", phoneCountry: "+44", phoneNational: "7911" }).national === "7911"
  );

  console.log(
    `\n${fail === 0 ? "SPLIT-PHONE E2E PASS" : "SPLIT-PHONE E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();