// learn-from-typing.test.js — "learn from what you type".
//
// The feature only earns its keep if it is predictable, so this suite is mostly
// about what is NOT learned:
//
//   * a field the fill already handled          -> never watched
//   * a question the answer bank already covers -> never offered again
//   * the same question answered differently    -> dropped, never overwritten
//   * one question, one entry                   -> enforced in storage too
//   * gender / race / files / consent           -> never learned
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const {
  APP_DIR,
  POPUP_JS,
  CONTENT_SRC,
  CONTENT_SCRIPTS,
  SHARED
} = require("./_popup-source");

const SITE = "https://boards.example.com/apply";

const FIXTURE = `<!doctype html><html><body>
  <label for="firstName">First Name</label><input id="firstName" type="text" />
  <label for="why">Why do you want this job?</label><input id="why" type="text" />
  <label for="hear">How did you hear about us?</label>
  <select id="hear">
    <option value="">-- select --</option>
    <option>LinkedIn</option><option>Glassdoor</option>
  </select>
  <label for="notes">Anything else?</label><textarea id="notes"></textarea>
  <label for="dupe1">Referral name</label><input id="dupe1" type="text" />
  <label for="dupe2">Referral name</label><input id="dupe2" type="text" />
  <label for="gender">Gender</label>
  <select id="gender">
    <option value="">-- set --</option><option>Man</option><option>Woman</option>
  </select>
  <label for="upload">Resume</label><input id="upload" type="file" />
  <label><input type="checkbox" id="consent" /> I agree to the privacy policy</label>
</body></html>`;

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(
    `${name.padEnd(58)}: ${
      detail === undefined ? "" : String(detail) + " "
    }${cond ? "PASS" : "FAIL"}`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A storage stub with real get/set/remove semantics. */
function storageStub(store) {
  return {
    local: {
      get: async (key) => {
        if (typeof key === "string") return { [key]: store[key] };
        if (Array.isArray(key)) {
          const out = {};
          key.forEach((k) => {
            out[k] = store[k];
          });
          return out;
        }
        return Object.assign({}, store);
      },
      set: async (obj) => {
        Object.assign(store, obj);
      },
      remove: async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          delete store[k];
        });
      }
    }
  };
}

/** Load a page with the REAL content scripts, run the fill, return the handles. */
async function pageWith(profile) {
  const store = { jobProfile: profile };
  const dom = new JSDOM(FIXTURE, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: SITE
  });
  const w = dom.window;
  w.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  const storage = storageStub(store);
  w.chrome = {
    storage,
    runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } }
  };
  w.eval(CONTENT_SRC);
  await w.__jobAutofillRun; // the fill itself, then learning is armed
  return { w, store, JA: w.__JobAutofill };
}

/** Commit a value the way a user does: set it, then fire change. */
function commit(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
}

const find = (list, needle) =>
  list.find((c) => SHARED.keyOf(c.question).indexOf(needle) !== -1);

(async () => {
  // ---- A. only what the fill left behind is watched -----------------------
  const A = await pageWith({ firstName: "Jane" });
  const wA = A.w;
  const id = (win, name) => win.document.getElementById(name);

  t(
    "A: learn.js is in the real injected list",
    CONTENT_SCRIPTS.indexOf("content/learning/answers.js") >= 0
  );
  t("A: armLearning is exposed to the page", typeof A.JA.armLearning === "function");

  commit(wA, id(wA, "why"), "Because I like pinning things.");
  commit(wA, id(wA, "hear"), "Glassdoor");
  commit(wA, id(wA, "notes"), "line one\n\nline two");
  commit(wA, id(wA, "firstName"), "Janet"); // the fill already handled this one
  commit(wA, id(wA, "gender"), "Woman"); // rule 4: demographics
  commit(wA, id(wA, "dupe1"), "Alice"); // rule 3: same question, two answers
  commit(wA, id(wA, "dupe2"), "Bob");
  id(wA, "consent").checked = true;
  id(wA, "consent").dispatchEvent(new wA.Event("change", { bubbles: true }));
  id(wA, "upload").dispatchEvent(new wA.Event("change", { bubbles: true }));

  await sleep(800); // let the debounced write land

  const learned = A.store.learnedAnswers || { candidates: [], skipped: [] };
  const list = learned.candidates;
  const why = find(list, "why do you want this job");
  const hear = find(list, "hear about us");
  const notes = find(list, "anything else");

  t("A: the new questions are captured", list.length === 3, list.length);
  t("A: a typed answer is captured", !!why && why.value === "Because I like pinning things.");
  t(
    "A: the question text becomes the key",
    !!why && why.question === "Why do you want this job?",
    why && why.question
  );
  t("A: the site it came from is recorded", !!why && why.site === "boards.example.com", why && why.site);
  t("A: a select records its OPTION TEXT", !!hear && hear.value === "Glassdoor", hear && hear.value);
  t(
    "A: a pasted paragraph keeps its line breaks",
    !!notes && notes.value === "line one\n\nline two",
    notes && JSON.stringify(notes.value)
  );
  t("A: a field the fill already handled is never learned", !find(list, "first name"));
  t("B: a gender select is never learned", !find(list, "gender"));
  t("B: a consent checkbox is never learned", !find(list, "privacy"));
  t("C: same question, different answer -> nothing learned", !find(list, "referral name"));
  t(
    "C: ...and the conflict is reported to the user",
    (learned.skipped || []).indexOf("Referral name") >= 0,
    JSON.stringify(learned.skipped)
  );

  // ---- D. a question the bank already covers is never offered again -------
  const D = await pageWith({
    firstName: "Jane",
    customSnippets: [
      { key: "hear about us", value: "Indeed" }, // covers by PHRASE
      { key: "why do you want this job", value: "Because." } // covers EXACTLY
    ]
  });
  commit(D.w, id(D.w, "why"), "A completely different reason.");
  commit(D.w, id(D.w, "hear"), "LinkedIn");
  commit(D.w, id(D.w, "notes"), "Only this one is new.");
  await sleep(800);

  const dList = (D.store.learnedAnswers || {}).candidates || [];
  t("D: an exactly-covered question is not offered again", !find(dList, "why do you want this job"));
  t("D: a phrase-covered question is not offered again", !find(dList, "hear about us"));
  t(
    "D: a genuinely new question still is",
    !!find(dList, "anything else") && dList.length === 1,
    dList.length
  );

  // ---- E. the storage shape enforces "one entry per question" -------------
  const sanitized = SHARED.sanitizeLearned({
    candidates: [
      { question: "Referral name", value: "Alice" },
      { question: "referral name!", value: "Bob" },
      { question: "", value: "no question" },
      { question: "Blank value", value: "" }
    ],
    skipped: ["Referral name", "", 42]
  });
  t(
    "E: two candidates for one question collapse to one",
    sanitized.candidates.length === 1,
    sanitized.candidates.length
  );
  t("E: ...and the first one wins", sanitized.candidates[0].value === "Alice");
  t("E: blank questions and answers are dropped", sanitized.candidates.length === 1);
  t(
    "E: skipped entries are cleaned",
    sanitized.skipped.length === 1 && sanitized.skipped[0] === "Referral name",
    JSON.stringify(sanitized.skipped)
  );

  const many = [];
  for (let i = 0; i < 40; i++) many.push({ question: "Q" + i, value: "v" + i });
  t(
    "E: the pending list is capped",
    SHARED.sanitizeLearned({ candidates: many }).candidates.length === SHARED.maxLearned,
    SHARED.maxLearned
  );

  const samples = [
    "Why do you want to work here?",
    "Desired Salary (custom snippet target)",
    "U.S. State",
    "  SpoNge  bob  ",
    "hear_about-us"
  ];
  t(
    "E: the dedupe rule and the filler agree on normalization",
    samples.every((s) => SHARED.keyOf(s) === A.JA.normalize(s))
  );

  // ---- F. the popup review step -------------------------------------------
  const popupHtml = fs.readFileSync(path.join(APP_DIR, "popup.html"), "utf8");
  const pdom = new JSDOM(popupHtml, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://example.com/"
  });
  const pw = pdom.window;
  const pd = pw.document;
  const pStore = { jobProfile: { firstName: "Jane" } };
  pw.chrome = {
    storage: storageStub(pStore),
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: { query: async () => [{ id: 7 }], sendMessage: () => {} },
    scripting: { executeScript: async () => [] }
  };
  pStore.learnedAnswers = {
    candidates: [
      {
        question: "How did you hear about us?",
        value: "LinkedIn",
        site: "boards.example.com",
        at: 1
      },
      { question: "Anything else?", value: "Nope", site: "", at: 2 }
    ],
    skipped: ["Referral name"]
  };

  pw.eval(
    POPUP_JS +
      "\n; window.__t = { loadLearned, saveAllLearned, dismissAllLearned," +
      " state: () => learnedState };"
  );
  const PT = pw.__t;
  const rows = () => Array.from(pd.querySelectorAll("#learnedRows .learn-row"));

  // Run the REAL bootstrap (this page already fired DOMContentLoaded).
  pd.dispatchEvent(new pw.Event("DOMContentLoaded"));
  await sleep(80);

  t("F: the review section appears", pd.getElementById("learnedSection").hidden === false);
  t("F: one row per candidate", rows().length === 2, rows().length);
  t(
    "F: the keyword is prefilled with the question",
    rows()[0].querySelector(".snip-key").value === "How did you hear about us?"
  );
  t(
    "F: the value is prefilled with the answer",
    rows()[0].querySelector(".snip-value").value === "LinkedIn"
  );
  t(
    "F: the question remembers where it came from",
    /boards\.example\.com/.test(rows()[0].querySelector(".snip-key").title)
  );
  const noteText = pd.getElementById("learnedNote").textContent;
  t("F: nothing is saved without a click", /Nothing is saved until you click Save/.test(noteText));
  t("F: nothing leaves the browser", /stay in this browser/.test(noteText), noteText);
  t(
    "F: the dropped question is explained",
    /1 question was answered differently/.test(noteText),
    noteText
  );

  rows()[0].querySelector(".learn-save").click(); // accept the first row
  await sleep(150);
  const bank = pStore.jobProfile.customSnippets || [];
  t(
    "F: saving appends it to the answer bank",
    bank.length === 1 &&
      bank[0].key === "How did you hear about us?" &&
      bank[0].value === "LinkedIn",
    JSON.stringify(bank)
  );
  t("F: the accepted candidate leaves the pending list", pStore.learnedAnswers.candidates.length === 1);
  t("F: its row disappears", rows().length === 1, rows().length);

  // The same question must not be bankable twice, even by hand-editing storage.
  pStore.learnedAnswers = {
    candidates: [{ question: "How did you hear about us?", value: "Glassdoor", site: "", at: 3 }],
    skipped: []
  };
  await PT.loadLearned();
  rows()[0].querySelector(".learn-save").click();
  await sleep(150);
  t(
    "F: a covered question is never added twice",
    (pStore.jobProfile.customSnippets || []).length === 1,
    (pStore.jobProfile.customSnippets || []).length
  );
  t("F: ...the candidate is dropped anyway", pStore.learnedAnswers.candidates.length === 0);
  t(
    "F: ...and the user is told why",
    /already in your answer bank/.test(pd.getElementById("status").textContent)
  );

  pStore.learnedAnswers = {
    candidates: [{ question: "Anything else?", value: "Nope", site: "", at: 4 }],
    skipped: []
  };
  await PT.loadLearned();
  rows()[0].querySelector(".snip-del").click(); // decline it
  await sleep(150);
  t(
    "F: declining removes it without touching the bank",
    pStore.learnedAnswers.candidates.length === 0 &&
      (pStore.jobProfile.customSnippets || []).length === 1
  );
  t(
    "F: the section hides once nothing is pending",
    pd.getElementById("learnedSection").hidden === true
  );

  pStore.learnedAnswers = {
    candidates: [
      { question: "Q one", value: "A", site: "", at: 5 },
      { question: "Q two", value: "B", site: "", at: 6 }
    ],
    skipped: []
  };
  await PT.loadLearned();
  pd.getElementById("saveLearnedAllBtn").click();
  await sleep(180);
  t(
    "F: Save all adds every row",
    (pStore.jobProfile.customSnippets || []).length === 3,
    (pStore.jobProfile.customSnippets || []).length
  );
  t("F: Save all clears the pending list", pStore.learnedAnswers.candidates.length === 0);
  t(
    "F: Save all reports what it did",
    /Saved 2 answers/.test(pd.getElementById("status").textContent)
  );

  // ---- G. the full editor shows them next to the bank --------------------
  const optionsHtml = fs.readFileSync(path.join(APP_DIR, "options.html"), "utf8");
  const odom = new JSDOM(optionsHtml, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://example.com/"
  });
  const ow = odom.window;
  const od = ow.document;
  const oStore = {
    jobProfile: { firstName: "Jane" },
    learnedAnswers: {
      candidates: [
        { question: "What is your notice period?", value: "2 weeks", site: "", at: 9 }
      ],
      skipped: []
    }
  };
  ow.chrome = {
    storage: storageStub(oStore),
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} }
  };
  ow.eval(POPUP_JS);
  od.dispatchEvent(new ow.Event("DOMContentLoaded"));
  await sleep(80);

  t(
    "G: the editor offers the candidate too",
    od.querySelectorAll("#learnedRows .learn-row").length === 1,
    od.querySelectorAll("#learnedRows .learn-row").length
  );
  od.querySelector("#learnedRows .learn-save").click();
  await sleep(180);
  t(
    "G: accepting it lands in the visible answer bank",
    od.querySelectorAll("#snippetRows .snip-row").length === 1,
    od.querySelectorAll("#snippetRows .snip-row").length
  );
  t(
    "G: with the keyword and value in place",
    od.querySelector("#snippetRows .snip-key").value === "What is your notice period?" &&
      od.querySelector("#snippetRows .snip-value").value === "2 weeks"
  );

  // ---- H. both pages load the same pieces in a workable order ------------
  // Stronger than a hard-coded file list: the popup and the options page must
  // load the SAME scripts in the SAME order, so a new file can never reach one
  // page and not the other. The shared bootstrap must be first (everyone reads
  // the keys it creates) and app.js last (it wires controls once the rest is
  // defined).
  const scriptList = (html) => {
    const found = [];
    const pattern = /<script\s+src="([^"]+)"\s*>/gi;
    let match = pattern.exec(html);
    while (match !== null) {
      found.push(match[1]);
      match = pattern.exec(html);
    }
    return found;
  };
  const popupScripts = scriptList(popupHtml);
  const optionsScripts = scriptList(optionsHtml);
  t(
    "H: both pages load the same scripts in the same order",
    popupScripts.length > 0 && JSON.stringify(popupScripts) === JSON.stringify(optionsScripts),
    popupScripts.join(", ")
  );
  t(
    "H: the shared bootstrap is loaded first",
    popupScripts[0] === "shared/index.js",
    popupScripts[0]
  );
  t(
    "H: editor.js is loaded last",
    popupScripts[popupScripts.length - 1] === "ui/editor.js",
    popupScripts[popupScripts.length - 1]
  );

  console.log(
    `\n${
      fail === 0 ? "LEARN-FROM-TYPING E2E PASS" : "LEARN-FROM-TYPING E2E FAIL"
    } (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();



