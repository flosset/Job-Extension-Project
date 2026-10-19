// cover-letter.test.js — cover-letter templates.
//
//   * {placeholders} are filled from the job on the page, and an unknown one is
//     left VISIBLE rather than silently becoming an empty string,
//   * the popup shows the finished letter, and the user copies it or asks for
//     it to be typed into the form (never as part of an ordinary fill),
//   * templates are edited on the options page and survive export/import.
"use strict";
const { JSDOM } = require("jsdom");
const { POPUP_JS, SHARED } = require("../_popup-source");

const RUNS_KEY = SHARED.keys.runs;

const SHELL = `<!doctype html><html><body data-page="popup">
  <div id="profileRow"><select id="profileSelect"></select></div>
  <p id="status"></p><ul id="unfilledList"></ul>
  <div id="coverSection" hidden>
    <select id="coverTemplate"></select>
    <p id="coverNote"></p>
    <pre id="coverPreview"></pre>
    <button id="coverCopyBtn"></button><button id="coverTypeBtn"></button>
  </div>
  <form id="profileForm"><input id="firstName" /><input id="lastName" />
    <input id="email" /><input id="phone" /><input id="city" />
    <div id="templateRows"></div><div id="snippetRows"></div>
    <div id="expRows"></div><div id="eduRows"></div>
  </form>
  <input id="resumeFile" /><button id="clearResumeBtn"></button>
  <button id="addTemplateBtn"></button><button id="saveBtn"></button>
</body></html>`;

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

function openPage(store, opts) {
  const options = opts || {};
  const dom = new JSDOM(SHELL, { runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  const copied = [];
  w.confirm = () => true;
  w.navigator.clipboard = { writeText: async (text) => copied.push(text) };
  w.chrome = {
    storage: {
      local: {
        get: async (key) =>
          typeof key === "string" ? { [key]: store[key] } : Object.assign({}, store),
        set: async (obj) => Object.assign(store, obj),
        remove: async () => {}
      }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
    tabs: {
      query: async () => [
        options.tab || { id: 7, title: "Staff Engineer - Acme", url: "https://acme.com/j/1" }
      ],
      sendMessage: async (tabId, message, extra) => {
        sent.push({ tabId, message, extra });
        if (options.sendThrows) throw new Error("Could not establish connection.");
        // The top frame has no box; an embedded frame does.
        if (extra && extra.frameId === 0) return { ok: false };
        return { ok: options.embedded !== false };
      }
    },
    scripting: { executeScript: async () => [{}] }
  };
  w.eval(
    POPUP_JS +
      "\n; window.__t = { coverTemplates, templateValues, composeCoverLetter, pageForTab, " +
      "refreshCoverLetter, selectedCoverText, renderCoverPreview, copyCoverLetter, " +
      "typeCoverLetter, addTemplateRow, renderTemplates, collectTemplates, readForm, " +
      "saveProfile, loadProfile, buildExportText, parseImportText, get templates() { " +
      "return coverTemplatesState; } };"
  );
  const api = w.__t;
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, d: w.document, t: api, store, sent, copied };
}

const statusText = (p) => p.d.getElementById("status").textContent;
const preview = (p) => p.d.getElementById("coverPreview").textContent;

/** A store with one template and a remembered run for tab 7. */
function storeWith(template, page) {
  const store = {
    jobProfile: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "+1 555 123 4567",
      city: "Austin",
      coverLetterTemplates: [template || { id: "t1", name: "Frontend", body: BODY }]
    }
  };
  if (page) {
    store[RUNS_KEY] = {
      "7": {
        tabId: 7,
        at: Date.now(),
        results: { unfilled: [{ label: "Why?", required: false, ref: "ja-1" }], frames: 1, iframes: 0, page }
      }
    };
  }
  return store;
}

const BODY =
  "Dear {company} team,\n\nI would like to apply for the {role} role in {city}. " +
  "I am {fullName} ({email}).\n\nYours,\n{firstName}\n{today}\n{typo}";

(async () => {
  // ---- A. templates are coerced ------------------------------------------
  const page = openPage(storeWith());
  await sleep(60);
  t("A: one template is read", page.t.templates.length === 1, page.t.templates.length);
  t("A: with its name", page.t.templates[0].name === "Frontend");
  t("A: with a stable id", page.t.templates[0].id === "t1", page.t.templates[0].id);

  t(
    "A: a body-less template is dropped",
    page.t.coverTemplates({ coverLetterTemplates: [{ name: "Empty", body: "   " }] }).length === 0
  );
  t(
    "A: a nameless template gets a name",
    page.t.coverTemplates({ coverLetterTemplates: [{ body: "Hi" }] })[0].name === "Template 1"
  );
  t(
    "A: an unnamed template gets a stable id",
    page.t.coverTemplates({ coverLetterTemplates: [{ body: "Hi" }] })[0].id === "t0"
  );
  t("A: no templates at all is fine", page.t.coverTemplates({}).length === 0);

  // ---- B. composition ----------------------------------------------------
  const values = page.t.templateValues(storeWith().jobProfile, {
    company: "Acme",
    role: "Senior Frontend Engineer"
  });
  t("B: the company comes from the page", values.company === "Acme", values.company);
  t("B: the role comes from the page", values.role === "Senior Frontend Engineer");
  t("B: the name is composed", values.fullName === "Jane Doe", values.fullName);
  t("B: today is a real date", /\d/.test(values.today), values.today);

  const composed = page.t.composeCoverLetter(
    { body: BODY },
    storeWith().jobProfile,
    { company: "Acme", role: "Senior Frontend Engineer" }
  );
  t("B: {company} is filled", /Dear Acme team/.test(composed));
  t("B: {role} is filled", /the Senior Frontend Engineer role/.test(composed));
  t("B: profile placeholders are filled", /in Austin/.test(composed) && /Jane Doe \(jane@example.com\)/.test(composed));
  t("B: a repeated placeholder is filled everywhere", (composed.match(/Jane/g) || []).length >= 1);
  t(
    "B: an unknown placeholder is LEFT VISIBLE",
    /\{typo\}/.test(composed),
    composed.split("\n").pop()
  );
  t("B: nothing is left as an empty hole", !/\{\s*\}/.test(composed));

  // ---- C. the popup shows it ---------------------------------------------
  const withPage = openPage(
    storeWith(undefined, { company: "Acme", role: "Senior Frontend Engineer", url: "https://acme.com/j/1" })
  );
  await sleep(80);
  t("C: the section is shown", withPage.d.getElementById("coverSection").hidden === false);
  t(
    "C: the picker lists the template",
    withPage.d.getElementById("coverTemplate").options.length === 1 &&
      withPage.d.getElementById("coverTemplate").options[0].textContent === "Frontend"
  );
  t("C: the preview shows the letter", /Dear Acme team/.test(preview(withPage)), preview(withPage).split("\n")[0]);
  t(
    "C: the job details come from the last fill",
    withPage.t.templates.length === 1 && /Senior Frontend Engineer/.test(preview(withPage))
  );
  t("C: no missing-details note", withPage.d.getElementById("coverNote").textContent === "");

  // ---- D. no templates, no section --------------------------------------
  const none = openPage({ jobProfile: { firstName: "Jane" } });
  await sleep(60);
  t("D: without templates the section stays hidden", none.d.getElementById("coverSection").hidden === true);

  // ---- E. before any fill, we do not invent a company --------------------
  const noRun = openPage(storeWith());
  await sleep(70);
  t(
    "E: {company} is NOT guessed from the host",
    !/Dear [a-z.]*\.?(io|com)/.test(preview(noRun)),
    preview(noRun).split("\n")[0]
  );
  t("E: and the note says so", /No job details on this page yet/.test(noRun.d.getElementById("coverNote").textContent), noRun.d.getElementById("coverNote").textContent);
  t("E: the role falls back to the tab title", /Staff Engineer/.test(preview(noRun)), preview(noRun).split("\n")[0]);

  // ---- F. copying --------------------------------------------------------
  await withPage.t.copyCoverLetter();
  await sleep(20);
  t("F: the letter is copied", withPage.copied.length === 1 && /Dear Acme team/.test(withPage.copied[0]));
  t(
    "F: the copy is the whole letter",
    withPage.copied[0] === withPage.t.selectedCoverText(),
    withPage.copied[0].length
  );
  t("F: and the popup says so", /Cover letter copied/.test(statusText(withPage)), statusText(withPage));

  // ---- G. typing it into the form ----------------------------------------
  await withPage.t.typeCoverLetter();
  await sleep(30);
  t("G: the top frame is asked first", withPage.sent[0].extra.frameId === 0, JSON.stringify(withPage.sent[0].extra));
  t("G: the text is sent verbatim", withPage.sent[0].message.text === withPage.t.selectedCoverText());
  t(
    "G: the message type is the cover-letter one",
    withPage.sent[0].message.type === "JOB_AUTOFILL_COVER_LETTER",
    withPage.sent[0].message.type
  );
  t("G: an embedded frame is asked next", withPage.sent.length === 2 && !withPage.sent[1].extra);
  t(
    "G: and the popup reports where it landed",
    /typed into the embedded form/.test(statusText(withPage)),
    statusText(withPage)
  );

  const nowhere = openPage(storeWith(), { embedded: false });
  await sleep(70);
  await nowhere.t.typeCoverLetter();
  await sleep(30);
  t(
    "G: with no box anywhere it points at Copy",
    /use Copy instead/.test(statusText(nowhere)),
    statusText(nowhere)
  );

  const gone = openPage(storeWith(), { sendThrows: true });
  await sleep(70);
  await gone.t.typeCoverLetter();
  await sleep(30);
  t(
    "G: on a page that has not been filled it says what to do",
    /Press Fill Application once/.test(statusText(gone)),
    statusText(gone)
  );

  // ---- H. the options page's editor --------------------------------------
  const editor = openPage(storeWith());
  await sleep(70);
  t("H: stored templates are rendered as rows", editor.d.querySelectorAll("#templateRows .tpl-row").length === 1);
  t(
    "H: with the name and body",
    editor.d.querySelector(".tpl-name").value === "Frontend" &&
      /Dear \{company\} team/.test(editor.d.querySelector(".tpl-body").value)
  );

  editor.d.querySelector(".tpl-body").value = "Hello {company}";
  const read = editor.t.readForm();
  t("H: the edit is collected", read.coverLetterTemplates.length === 1);
  t("H: with the new body", read.coverLetterTemplates[0].body === "Hello {company}");
  await editor.t.saveProfile();
  await sleep(30);
  t(
    "H: and saved to storage",
    editor.store.jobProfile.coverLetterTemplates[0].body === "Hello {company}",
    editor.store.jobProfile.coverLetterTemplates[0].body
  );

  editor.t.addTemplateRow("Second", "Body two");
  t("H: a row can be added", editor.d.querySelectorAll("#templateRows .tpl-row").length === 2);
  editor.d.querySelectorAll(".tpl-row")[1].querySelector(".tpl-body").value = "";
  t(
    "H: an empty body is not collected",
    editor.t.collectTemplates().length === 1,
    editor.t.collectTemplates().length
  );

  // ---- I. export / import keeps them -------------------------------------
  const text = editor.t.buildExportText(editor.store.jobProfile);
  const parsed = editor.t.parseImportText(text);
  t("I: the export carries the templates", Array.isArray(parsed.coverLetterTemplates));
  t(
    "I: round-tripping keeps the body",
    parsed.coverLetterTemplates[0].body === "Hello {company}",
    parsed.coverLetterTemplates[0].body
  );
  t(
    "I: and the name",
    parsed.coverLetterTemplates[0].name === "Frontend",
    parsed.coverLetterTemplates[0].name
  );

  console.log(
    `\n${fail === 0 ? "COVER-LETTER E2E PASS" : "COVER-LETTER E2E FAIL"} (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();