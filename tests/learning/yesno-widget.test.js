// yesno-widget.test.js — learn a button-based Yes/No question, then fill it.
//
// Ashby asks binary questions as two <button type="submit"> elements. No path
// understood that shape: radios.js wants input[type=radio], and the learners
// skip `button`/`submit`. So these were neither filled nor offered.
//
// Guarantees under test:
//   1. an ANSWERED pair is offered for learning, as a host-scoped widget;
//   2. the learned value is a LITERAL (a widget is a captured structure, not a
//      pointer into the profile);
//   3. an UNANSWERED pair is not offered (nothing to remember);
//   4. a lone action button is never offered, however it is clicked;
//   5. the stored widget replays: the matching button gets pressed from the
//      answer bank / profile, negation-safe;
//   6. a pair with no agreeing option is left alone rather than guessed at.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const { APP_DIR } = require("../_popup-source");
const SOURCE = require("../_popup-source").CONTENT_SCRIPTS
  .map((f) => fs.readFileSync(path.join(APP_DIR, f), "utf8"))
  .join("\n");

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(
    `${name} : ${JSON.stringify(actual)} ${ok ? "PASS" : "FAIL"}` +
      (ok ? "" : `   (expected ${JSON.stringify(expected)})`)
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load the real content scripts against a page, with a fake storage. */
function loadPage(bodyHtml, storage) {
  const store = Object.assign({}, storage || {});
  const dom = new JSDOM(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
    {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      // A real ORIGIN, because a saved widget is host-scoped and the recipe
      // store refuses one with an empty host. Without this the learner would
      // build a correct candidate and the store would silently drop it — a test
      // artefact that would hide a genuine failure.
      url: "https://jobs.ashbyhq.com/brainco/abc/application"
    }
  );
  const { window } = dom;
  window.Element.prototype.getClientRects = function () {
    return [{ width: 10, height: 10 }];
  };
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return Object.assign({}, store);
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (store[k] !== undefined) out[k] = store[k];
          });
          return out;
        },
        set: async (obj) => { Object.assign(store, obj); }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: { sendMessage: () => {} }
  };
  window.eval(SOURCE);
  return { window, document: window.document, store, JA: window.__JobAutofill };
}

const YESNO_HTML = (q, cls) => `
  <div class="fieldEntry ${cls || ""}">
    <label class="question-title">${q}</label>
    <div class="input-yesno">
      <button type="submit" aria-pressed="false">Yes</button>
      <button type="submit" aria-pressed="false">No</button>
    </div>
  </div>`;

(async () => {
  // --- 1/2. an answered pair becomes a literal, host-scoped widget --------
  const A = loadPage(YESNO_HTML("Are you currently legally authorized to work in the US?"));
  const pairsA = A.JA.yesNoPairs();
  check("1: one pair was found", pairsA.length, 1);
  check("1: its question is readable",
    /legally authorized/i.test(pairsA[0].question), true);

  // Arm the learner FIRST — the click listener only exists once armed, which is
  // the real order (autofill.js arms it at the end of a fill, and the user then
  // answers by hand).
  A.JA.armWidgetLearning(new Set());

  // Stand in for the PORTAL's own handler: on a real page Ashby sets
  // aria-pressed when its button is clicked. jsdom has no such handler, so
  // without this the pair would look unanswered and we would be testing a state
  // that cannot occur in a browser.
  pairsA[0].buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      pairsA[0].buttons.forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
  });
  pairsA[0].buttons[0].dispatchEvent(
    new A.window.MouseEvent("click", { bubbles: true })
  );
  check("2: the click recorded 'Yes'", A.JA.yesNoAnswer(pairsA[0]), "Yes");

  await sleep(900);

  const cands = (A.store.widgetCandidates || {}).candidates || [];
  check("1: an answered pair is offered for learning", cands.length, 1);
  if (cands[0]) {
    check("2: it is scoped to the host", cands[0].host, "jobs.ashbyhq.com");
    const fieldKeys = Object.keys(cands[0].fields || {});
    check("2: it has exactly one field", fieldKeys.length, 1);
    const row = (cands[0].rows || [])[0] || {};
    const cell = row[fieldKeys[0]] || {};
    check("2: the value is a LITERAL, not a profile binding", cell.source, "literal");
    check("2: the literal is the answer given", cell.value, "Yes");
    check("2: the anchor is the question", /legally authorized/i.test(cands[0].anchor[0]), true);
  }

  // --- 3. an unanswered pair is not offered ------------------------------
  const B = loadPage(YESNO_HTML("Is your expected graduation date between June 2027 and June 2028?"));
  B.JA.armWidgetLearning(new Set());
  B.document.dispatchEvent(new B.window.MouseEvent("click", { bubbles: true }));
  await sleep(900);
  check("3: an unanswered pair is NOT offered",
    ((B.store.widgetCandidates || {}).candidates || []).length, 0);

  // --- 4. a lone action button is never offered --------------------------
  const C = loadPage(`<div><button type="submit">Submit Application</button></div>`);
  const lone = C.document.querySelector("button");
  C.JA.pressButton(lone);
  C.JA.armWidgetLearning(new Set());
  C.document.dispatchEvent(new C.window.MouseEvent("click", { bubbles: true }));
  await sleep(900);
  check("4: a lone Submit is NOT offered",
    ((C.store.widgetCandidates || {}).candidates || []).length, 0);
  check("4: and it is not recognised as a pair", C.JA.yesNoPairFor(lone), null);

  // --- 5. fill: the stored answer drives the pair ------------------------
  const D = loadPage(YESNO_HTML("Are you available to work full-time for the co-op?"));
  const used = new Set();
  const profile = { customSnippets: [{ key: "available to work full-time", value: "No" }] };
  const filledCount = D.JA.fillYesNoPairs(profile, used,
    [{ key: "available to work full-time", value: "No" }]);
  check("5: the pair was filled from the answer bank", filledCount, 1);
  const pairD = D.JA.yesNoPairs()[0];
  check("5: the No button is the one pressed", D.JA.yesNoAnswer(pairD), "No");

  // --- 6. no agreeing option -> left alone -------------------------------
  // A REAL pair ("Yes" / "No"), asked in the negative. A stored "Yes" must not
  // be pressed onto the "No" button just because the question contains a
  // negation — the polarity reader has to agree with the stored answer.
  const E = loadPage(YESNO_HTML("Are you NOT authorized to work in the US?"));
  const pairE = E.JA.yesNoPairs()[0];
  check("6: a negatively-worded question is still a valid pair", !!pairE, true);
  check("6: a Yes answer presses the Yes button",
    (E.JA.chooseYesNo(pairE.buttons, "Yes"), E.JA.yesNoAnswer(pairE)), "Yes");
  pairE.buttons.forEach((b) => b.setAttribute("aria-pressed", "false"));
  check("6: a No answer presses the No button",
    (E.JA.chooseYesNo(pairE.buttons, "No"), E.JA.yesNoAnswer(pairE)), "No");

  // Two options that BOTH mean "no" are not a Yes/No pair at all — refusing
  // them is what stops us treating an arbitrary two-button toolbar as an answer.
  const E2 = loadPage(`
    <div class="fieldEntry">
      <label>Tell us about your authorization</label>
      <div class="input-yesno">
        <button type="submit" aria-pressed="false">I am not authorized</button>
        <button type="submit" aria-pressed="false">I am not authorized either</button>
      </div>
    </div>`);
  check("6: two options meaning the same thing are refused as a pair",
    E2.JA.yesNoPairs().length, 0);

  // --- 7. an answered pair is not re-filled -----------------------------
  const F = loadPage(YESNO_HTML("Are you comfortable working on-site?"));
  const pairF = F.JA.yesNoPairs()[0];
  F.JA.pressButton(pairF.buttons[1]); // the user already said No
  const again = F.JA.fillYesNoPairs(
    { customSnippets: [{ key: "on-site", value: "Yes" }] },
    new Set(),
    [{ key: "on-site", value: "Yes" }]
  );
  check("7: an already-answered pair is left alone", again, 0);
  check("7: and keeps the user's answer", F.JA.yesNoAnswer(pairF), "No");

  // --- 8. the anchor survives the recipe store's 40-char keyword cap ------
  // `sanitizeRecipes` clips every keyword at 40 characters. Storing the whole
  // question as the anchor silently truncated it, so the recipe could never
  // match the page again — a widget that is saved and then never replays.
  // Ashby's longest question is far past 40 characters.
  const LONG = loadPage(YESNO_HTML(
    "Are you available to work full-time for the entire co-op, " +
    "January 11 - April 30, 2027 in San Francisco, CA?"
  ));
  LONG.JA.armWidgetLearning(new Set());
  const longPair = LONG.JA.yesNoPairs()[0];
  check("8: the long question is still recognised as a pair", !!longPair, true);
  LONG.JA.pressButton(longPair.buttons[0]);

  const built = LONG.JA.widgetLearnInternals.buildYesNoCandidate(longPair);
  const anchor = built && built.candidate && built.candidate.anchor[0];
  check("8: the anchor is short enough to survive the cap",
    typeof anchor === "string" && anchor.length > 0 && anchor.length <= 40, true);
  check("8: the anchor is still distinctive (not the whole question)",
    anchor !== LONG.JA.normalize(longPair.question), true);

  // It must pass through the store intact — the real proof.
  const SHARED = LONG.window.JOB_AUTOFILL_SHARED;
  const sanitized = SHARED.sanitizeWidgetCandidates({
    candidates: [built.candidate], skipped: []
  });
  check("8: the candidate survives sanitisation", sanitized.candidates.length, 1);
  check("8: the stored anchor is not truncated",
    sanitized.candidates[0].anchor[0], anchor);
  check("8: the stored field keyword matches too",
    sanitized.candidates[0].fields[Object.keys(sanitized.candidates[0].fields)[0]][0],
    anchor);

  // --- 9. reporting a pair must not throw --------------------------------
  // Regression: the unfilled report called `pair.buttons.some(groupVisible)`,
  // passing groupVisible as a predicate — so it received ONE button and called
  // `button.some(...)`, throwing "group.some is not a function" and aborting the
  // ENTIRE FILL (caught live on Ashby: `[JobAutofill] failed: group.some is not
  // a function`, filled: 0). Every visible pair short-circuited before the
  // predicate ran, which is why unit tests passed. This one HIDES the pair so
  // the predicate is actually executed.
  const G = loadPage(YESNO_HTML("Are you comfortable working on-site?"));
  const pairG = G.JA.yesNoPairs();
  check("9: the pair is detected while visible", pairG.length, 1);

  let threw = null;
  try {
    G.JA.report.collectUnfilled(new Set());
  } catch (err) {
    threw = String((err && err.message) || err);
  }
  check("9: reporting an unfilled list does not throw", threw, null);

  // Now make the buttons invisible and report again — the path that threw.
  pairG[0].buttons.forEach((b) => {
    b.getClientRects = () => ({ length: 0 });
  });
  let threw2 = null;
  let reported = null;
  try {
    reported = G.JA.report.collectUnfilled(new Set());
  } catch (err) {
    threw2 = String((err && err.message) || err);
  }
  check("9: reporting a HIDDEN pair does not throw either", threw2, null);
  check("9: a hidden pair is not reported as left for you",
    reported.some((e) => /on-site/i.test(e.label)), false);

  // --- 10. REPLAY: a saved widget fills the pair on a later page ----------
  // Regression: learning had its own route but replay did not. Replay went only
  // through fillSectionBlocks, which requires a REPEATED block (>=2 same-shaped
  // siblings). A Yes/No question is a SINGLE pair, so sectionBlocks() returned
  // [] and the saved recipe was skipped in silence — learned, saved, and never
  // replayed. Caught live on Ashby: the pair stayed unpressed after a refill.
  const R = loadPage(YESNO_HTML("Are you currently legally authorized to work in the US?"));
  // The anchor must be a CONTIGUOUS phrase that really appears in the question:
  // matchesKeywords tests whole phrases with word boundaries, so a rebuilt token
  // string like "legally authorized work" never matches "legally authorized TO
  // work". This is exactly the bug the live run exposed.
  const recipe = {
    host: "jobs.ashbyhq.com",
    name: "authorized",
    fingerprint: "legally authorized",
    anchor: ["legally authorized"],
    confirm: [["yes"], ["no"]],
    addButton: [],
    dateFormat: "none",
    fields: { legallyauthorized: ["legally authorized"] },
    rows: [{ legallyauthorized: { source: "literal", value: "No" } }]
  };
  const replayUsed = new Set();
  const replay = R.JA.replayYesNoWidget([recipe], "jobs.ashbyhq.com", replayUsed);

  check("10: the saved widget replays", replay.filled, 1);
  check("10: the stored answer is the one pressed",
    R.JA.yesNoAnswer(R.JA.yesNoPairs()[0]), "No");
  check("10: the pair is claimed", replayUsed.size, 2);

  // A recipe for a DIFFERENT host must do nothing at all.
  const replayForeign = R.JA.replayYesNoWidget(
    [Object.assign({}, recipe, { host: "boards.greenhouse.io" })],
    "jobs.ashbyhq.com",
    new Set()
  );
  check("10: a foreign-host recipe does nothing", replayForeign.filled, 0);

  // A recipe whose anchor does not match this question must do nothing.
  const replayWrongAnchor = R.JA.replayYesNoWidget(
    [Object.assign({}, recipe, { anchor: ["something else entirely"] })],
    "jobs.ashbyhq.com",
    new Set()
  );
  check("10: a non-matching anchor does nothing", replayWrongAnchor.filled, 0);

  // An already-answered pair is never re-pressed.
  const replayAgain = R.JA.replayYesNoWidget([recipe], "jobs.ashbyhq.com", new Set());
  check("10: an answered pair is left alone", replayAgain.filled, 0);

  console.log("");
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`YESNO-WIDGET E2E ${verdict} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})();
