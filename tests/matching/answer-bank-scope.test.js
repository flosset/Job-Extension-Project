// answer-bank-scope.test.js — review items #2, #3, #5.
//
//   #2  An answer-bank key must not match an unrelated field. Before this fix
//       "Why do you want to work here" emitted the word "work", which matched
//       a "Work authorization" field.
//   #3  Loose substring selectors (name*="state" -> "statement", name*="tel" ->
//       "hotel", name*="last" -> "last_employer", name*="first" -> "first_job",
//       name*="personal" -> ...) must no longer claim the wrong field.
//   #5  A single "Full Name" field (Lever-style) is filled, derived from
//       first + last, unless the profile sets an explicit override.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const { APP_DIR: APP } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP, f), "utf8"))
  .join("\n");

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${name} : ${JSON.stringify(actual)} ${ok ? "PASS" : "FAIL"}` +
      (ok ? "" : `   (expected ${JSON.stringify(expected)})`)
  );
}

/** Load the real sources into a page with the given profile, await the run. */
function load(html, profile) {
  return new Promise((resolve) => {
    const vc = new VirtualConsole();
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc
    });
    const { window } = dom;
    window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
    window.Element.prototype.getBoundingClientRect = () => ({
      width: 10, height: 10, top: 0, left: 0
    });
    let report = null;
    window.chrome = {
      storage: { local: { get: async () => ({ jobProfile: profile || null }) } },
      runtime: { sendMessage: (m) => { report = m; } }
    };
    window.eval(SOURCE);
    (async () => {
      await Promise.race([
        window.__jobAutofillRun,
        new Promise((r) => setTimeout(r, 15000))
      ]);
      resolve({ window, report });
    })();
  });
}

function val(window, id) {
  const el = window.document.getElementById(id);
  return el ? el.value : "(missing)";
}

(async () => {
  // --- #2 snippetKeywords scope ------------------------------------------
  const blank = await load("<!doctype html><html><body></body></html>", {});
  const JA = blank.window.__JobAutofill;

  const longKey = JA.snippetKeywords("Why do you want to work here");
  check("#2 long key keeps the full phrase", longKey[0], "why do you want to work here");
  check("#2 long key does NOT emit 'work'", longKey.indexOf("work"), -1);
  check("#2 long key does NOT emit 'here'", longKey.indexOf("here"), -1);
  check("#2 long key has no single words", longKey.length, 1);

  const shortKey = JA.snippetKeywords("Desired Salary");
  check("#2 short key keeps 'salary'", shortKey.indexOf("salary") >= 0, true);
  check("#2 one-word key", JA.snippetKeywords("notice"), ["notice"]);
  check("#2 stopword-only key", JA.snippetKeywords("why work"), ["why work"]);

  // --- #2 the actual hijack: answer bank vs a 'Work authorization' field ---
  const bankHtml =
    "<!doctype html><html><body>" +
    '<label for="work_auth">Work authorization</label>' +
    '<input id="work_auth" name="work_auth" type="text" />' +
    '<label for="why">Why do you want to work here?</label>' +
    '<textarea id="why" name="why"></textarea>' +
    "</body></html>";
  const bank = await load(bankHtml, {
    customSnippets: [
      { key: "Why do you want to work here", value: "Because I love pinning things." }
    ]
  });
  check(
    "#2 matching textarea IS filled",
    val(bank.window, "why"),
    "Because I love pinning things."
  );
  check("#2 Work authorization is NOT hijacked", val(bank.window, "work_auth"), "");

  // --- #3 loose selectors --------------------------------------------------
  const looseHtml =
    "<!doctype html><html><body>" +
    '<label for="a">First Name</label><input id="first_name" name="first_name" type="text" />' +
    '<label for="b">State</label><input id="state" name="address_state" type="text" />' +
    '<label for="c">Phone</label><input id="tel" name="tel" type="text" />' +
    '<label for="d">Website</label><input id="personal_site" name="personal_site" type="text" />' +
    '<input id="statement" name="statement" type="text" />' +
    '<input id="hotel" name="hotel" type="text" />' +
    '<input id="last_employer" name="last_employer" type="text" />' +
    '<input id="first_job" name="first_job" type="text" />' +
    '<input id="personal_notes" name="personal_notes" type="text" />' +
    "</body></html>";
  const loose = await load(looseHtml, {
    firstName: "Jane",
    lastName: "Doe",
    phone: "+1 555 111 2222",
    state: "TX",
    portfolio: "https://portfolio.example.com"
  });
  const lw = loose.window;
  check("#3 first_name IS filled", val(lw, "first_name"), "Jane");
  check("#3 address_state IS filled", val(lw, "state"), "TX");
  check("#3 tel IS filled", val(lw, "tel"), "+1 555 111 2222");
  check("#3 personal_site IS filled", val(lw, "personal_site"), "https://portfolio.example.com");
  check("#3 'statement' NOT treated as state", val(lw, "statement"), "");
  check("#3 'hotel' NOT treated as phone", val(lw, "hotel"), "");
  check("#3 'last_employer' NOT treated as last name", val(lw, "last_employer"), "");
  check("#3 'first_job' NOT treated as first name", val(lw, "first_job"), "");
  check("#3 'personal_notes' NOT treated as portfolio", val(lw, "personal_notes"), "");

  // --- #5 fullName ---------------------------------------------------------
  const fullHtml =
    '<!doctype html><html><body><label for="name">Full Name</label>' +
    '<input id="name" name="name" type="text" /></body></html>';
  const derived = await load(fullHtml, { firstName: "Jane", lastName: "Doe" });
  check("#5 full name derived from first + last", val(derived.window, "name"), "Jane Doe");

  const override = await load(fullHtml, {
    firstName: "Jane", lastName: "Doe", fullName: "JJ Doe"
  });
  check("#5 explicit override wins", val(override.window, "name"), "JJ Doe");

  const allThree = await load(
    '<!doctype html><html><body>' +
      '<label for="fn">First Name</label><input id="fn" name="first_name" type="text" />' +
      '<label for="ln">Last Name</label><input id="ln" name="last_name" type="text" />' +
      '<label for="nm">Full Name</label><input id="nm" name="name" type="text" />' +
      "</body></html>",
    { firstName: "Jane", lastName: "Doe" }
  );
  check("#5 first name still its own field", val(allThree.window, "fn"), "Jane");
  check("#5 last name still its own field", val(allThree.window, "ln"), "Doe");
  check("#5 full name filled alongside them", val(allThree.window, "nm"), "Jane Doe");

  // --- #4 answer bank drives native <select> and radio groups --------------
  const reactiveHtml =
    "<!doctype html><html><body>" +
    "<fieldset><legend>Are you willing to relocate?</legend>" +
    '<label><input type="radio" name="relocate" value="Yes" /> Yes</label>' +
    '<label><input type="radio" name="relocate" value="No" /> No</label>' +
    "</fieldset>" +
    "<fieldset><legend>Do you require sponsorship?</legend>" +
    '<label><input type="radio" name="sponsor" value="No" /> No</label>' +
    "</fieldset>" +
    '<label for="hear">How did you hear about us?</label>' +
    '<select id="hear" name="hear">' +
    '<option value="">Select...</option>' +
    '<option value="li">LinkedIn</option>' +
    '<option value="ref">Referral</option>' +
    "</select></body></html>";
  const reactive = await load(reactiveHtml, {
    customSnippets: [
      { key: "willing to relocate", value: "Yes" },
      { key: "how did you hear about us", value: "LinkedIn" },
      { key: "require sponsorship", value: "Yes" }
    ]
  });
  const rw = reactive.window;
  const radios = (v) =>
    Array.from(rw.document.querySelectorAll('input[type="radio"][value="' + v + '"]'));
  const relocateYes = radios("Yes").filter((r) => r.name === "relocate")[0];
  const relocateNo = radios("No").filter((r) => r.name === "relocate")[0];
  const sponsorNo = radios("No").filter((r) => r.name === "sponsor")[0];
  check("#4 radio Yes selected from answer bank", relocateYes.checked, true);
  check("#4 radio No not selected", relocateNo.checked, false);
  check("#4 native select chosen from answer bank", val(rw, "hear"), "li");
  check("#4 opposite-only radio group left UNSELECTED", sponsorNo.checked, false);

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`SNIPPET+SELECTOR+FULLNAME E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();

