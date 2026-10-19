// shadow-dom.test.js — Shadow DOM (web-component ATS widgets).
//
// Newer ATS widgets render their fields inside a shadow root, which a plain
// document.querySelectorAll() cannot see — the field simply looks missing. Every
// field scan now walks open shadow roots. A CLOSED root is unreachable by design
// and nothing here pretends otherwise.
"use strict";
const { JSDOM } = require("jsdom");
const { CONTENT_SRC } = require("../_popup-source");

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
  const store = { jobProfile: profile || { firstName: "Jane", lastName: "Doe", email: "j@example.com" } };
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: SITE
  });
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

const unfilled = (p) => (p.report.unfilled || []).map((u) => u.label).join(" | ");

/**
 * A page whose form lives inside web components.
 * <ja-form> (open) holds the fields; <ja-nested> (open) is nested inside it;
 * <ja-secret> is CLOSED and must stay untouched.
 */
const SHADOW_PAGE = `<!doctype html><html><body>
  <form>
    <ja-form id="form"></ja-form>
    <ja-secret id="secret"></ja-secret>
  </form>
  <script>
    class JaForm extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML =
          '<div>' +
          '  <label for="fname">First Name</label>' +
          '  <input id="fname" name="first_name" />' +
          '  <label for="mail">Email Address</label>' +
          '  <input id="mail" name="contact_email" type="email" />' +
          '  <label for="ctry">Country</label>' +
          '  <select id="ctry" name="country">' +
          '    <option value="">Select…</option>' +
          '    <option value="United States">United States</option>' +
          '    <option value="Canada">Canada</option>' +
          '  </select>' +
          '  <ja-nested id="inner"></ja-nested>' +
          '</div>';
      }
    }
    customElements.define("ja-form", JaForm);

    // A SECOND level of shadow root, inside the first.
    class JaNested extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML =
          '<label for="deep">City</label><input id="deep" name="city" />' +
          '<label for="note">Anything else?</label><textarea id="note" name="notes"></textarea>';
      }
    }
    customElements.define("ja-nested", JaNested);

    // A CLOSED root: element.shadowRoot is null and nothing can reach in.
    class JaSecret extends HTMLElement {
      connectedCallback() {
        const root = this.attachShadow({ mode: "closed" });
        root.innerHTML = '<label for="hidden">Phone</label><input id="hidden" name="phone" />';
        this.secret = root;
      }
    }
    customElements.define("ja-secret", JaSecret);
  </script>
</body></html>`;

/** Reach into the open roots the way the page itself does. */
const deepField = (p, selector) => {
  const outer = p.d.getElementById("form").shadowRoot;
  return outer ? outer.querySelector(selector) : null;
};

/** A profile that covers every field the shadow fixture renders. */
const SHADOW_PROFILE = {
  firstName: "Jane",
  lastName: "Doe",
  email: "j@example.com",
  country: "United States",
  city: "Austin"
};

(async () => {
  // ---- A. fields inside an open shadow root are filled -------------------
  const a = await pageWith(SHADOW_PAGE, SHADOW_PROFILE);
  t("A: the component has an open root", !!a.d.getElementById("form").shadowRoot);
  t(
    "A: a shadow field is filled by its label",
    deepField(a, "#fname").value === "Jane",
    deepField(a, "#fname").value
  );
  t(
    "A: a shadow email field is filled",
    deepField(a, "#mail").value === "j@example.com",
    deepField(a, "#mail").value
  );
  t(
    "A: a shadow <select> is filled",
    deepField(a, "#ctry").value === "United States",
    deepField(a, "#ctry").value
  );
  t("A: the fill counted them", a.report.filled >= 4, a.report.filled);

  // ---- B. a nested shadow root works too ---------------------------------
  const inner = deepField(a, "ja-nested").shadowRoot;
  t("B: the nested component has a root", !!inner);
  t(
    "B: a doubly-nested field is FILLED",
    inner.querySelector("#deep").value === "Austin",
    JSON.stringify(inner.querySelector("#deep").value)
  );
  t(
    "B: a nested textarea is left for the user",
    /Anything else\?/.test(unfilled(a)),
    unfilled(a)
  );

  // ---- C. a CLOSED shadow root is untouched, and admitted ----------------
  const secret = a.d.getElementById("secret");
  t("C: a closed root is not exposed", secret.shadowRoot === null);
  t(
    "C: its field was not filled",
    !secret.secret || secret.secret.querySelector("#hidden").value === "",
    secret.secret ? JSON.stringify(secret.secret.querySelector("#hidden").value) : "(no handle)"
  );
  t("C: and the page is not falsely reported as empty", a.report.filled >= 4);

  // ---- D. labels inside the shadow root are read -------------------------
  t(
    "D: a label inside the root was used for matching",
    deepField(a, "#mail").value === "j@example.com"
  );
  t(
    "D: queryAll finds shadow fields",
    a.JA.queryAll("#fname").length === 1,
    a.JA.queryAll("#fname").length
  );
  t(
    "D: ...and does not duplicate light-DOM matches",
    a.JA.queryAll("form").length === 1,
    a.JA.queryAll("form").length
  );

  // ---- E. the traversal helpers themselves -------------------------------
  t("E: shadowRoots finds both open roots", a.JA.shadowRoots().length === 2, a.JA.shadowRoots().length);
  t(
    "E: scopes is the document plus both roots",
    a.JA.scopes().length === 3,
    a.JA.scopes().length
  );
  t(
    "E: rootOf reports the root a node lives in",
    a.JA.rootOf(deepField(a, "#fname")) === a.d.getElementById("form").shadowRoot
  );
  t(
    "E: parentOrHost climbs from a root into its host",
    a.JA.parentOrHost(deepField(a, "div")) === a.d.getElementById("form").shadowRoot.host,
    String(a.JA.parentOrHost(deepField(a, "div")) === a.d.getElementById("form").shadowRoot.host)
  );
  t(
    "E: a plain light-DOM page still has exactly one scope",
    (await pageWith("<form><input id='x' name='first_name' /></form>")).JA.scopes().length === 1
  );

  // ---- F. light DOM is unaffected ----------------------------------------
  const f = await pageWith(
    "<form><label for='fn'>First Name</label><input id='fn' name='first_name' />" +
      "<label for='ph'>Phone</label><input id='ph' name='phone' type='tel' /></form>",
    { firstName: "Jane", phone: "+1 555 123 4567" }
  );
  t(
    "F: light-DOM fields still fill",
    f.d.getElementById("fn").value === "Jane" &&
      f.d.getElementById("ph").value === "+1 555 123 4567"
  );
  t("F: and the pool is not duplicated", f.JA.fieldPool().length === 2, f.JA.fieldPool().length);

  // ---- G. radios inside a shadow root ------------------------------------
  const g = await pageWith(
    `<form><ja-radios id="r"></ja-radios>
     <script>
       class JaRadios extends HTMLElement {
         connectedCallback() {
           const root = this.attachShadow({ mode: "open" });
           root.innerHTML =
             '<fieldset><legend>Are you legally authorized to work? *</legend>' +
             '<label><input type="radio" name="auth" value="yes" />Yes</label>' +
             '<label><input type="radio" name="auth" value="no" />No</label></fieldset>';
         }
       }
       customElements.define("ja-radios", JaRadios);
     </script></form>`,
    { firstName: "Jane", workAuthorized: "Yes" }
  );
  const radios = g.d.getElementById("r").shadowRoot.querySelectorAll("input");
  t(
    "G: a shadow radio group is seen as ONE question",
    g.JA.radioGroups().length === 1,
    g.JA.radioGroups().length
  );
  t(
    "G: and the right answer is chosen",
    radios[0].checked === true && radios[1].checked === false,
    radios[0].checked + "/" + radios[1].checked
  );

  console.log(
    `\n${fail === 0 ? "SHADOW-DOM E2E PASS" : "SHADOW-DOM E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();