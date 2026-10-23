// shortcut-badge.test.js — the Alt+Shift+F shortcut and the toolbar badge.
//
// The shortcut exists so a multi-page Workday form does not need the popup
// opened (and closed) for every page, so this suite checks that the fill really
// starts without the popup, that it reaches EVERY frame, that the badge reports
// the outcome, and that the badge has a single owner when two things want to
// show something at once.
//
// It also guards the one thing that could silently rot: the popup, the service
// worker and the injected run must all agree on the content-script list.
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { APP_DIR, POPUP_JS, CONTENT_SCRIPTS, SHARED_SCRIPTS } = require("../_popup-source");

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "manifest.json"), "utf8")
);
const WORKER_SRC = fs.readFileSync(path.join(APP_DIR, "background.js"), "utf8");
const SHARED_SRC = SHARED_SCRIPTS
  .map((file) => fs.readFileSync(path.join(APP_DIR, file), "utf8"))
  .join("\n");

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
const exists = (file) => fs.existsSync(path.join(APP_DIR, file));

/**
 * Load background.js the way Chrome does. The shared/ files are inlined first
 * because the worker would otherwise importScripts() them — the real
 * importScripts call is asserted separately, and the stub stands in for it here.
 */
function loadWorker(store, control) {
  const badge = [];
  const titles = [];
  const injected = [];
  const listeners = {};

  const chrome = {
    action: {
      setBadgeText: (o) => badge.push(o.text),
      setBadgeBackgroundColor: () => {},
      setTitle: (o) => titles.push(o.title)
    },
    storage: {
      local: {
        get: async (key) =>
          typeof key === "string" ? { [key]: store[key] } : Object.assign({}, store),
        set: async (obj) => Object.assign(store, obj)
      },
      onChanged: { addListener: (fn) => (listeners.storage = fn) }
    },
    commands: { onCommand: { addListener: (fn) => (listeners.command = fn) } },
    runtime: {
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      onInstalled: { addListener: (fn) => (listeners.installed = fn) },
      onStartup: { addListener: (fn) => (listeners.startup = fn) }
    },
    tabs: { query: async () => [control.tab] },
    scripting: {
      executeScript: async (options) => {
        injected.push(options);
        if (control.throws) throw new Error(control.throws);
        return new Array(control.frames).fill({});
      }
    }
  };

  /* eslint-disable no-new-func */
  const build = new Function(
    "chrome",
    "importScripts",
    SHARED_SRC +
      "\n" +
      WORKER_SRC +
      "\n; return { state, render, refreshPending, startShortcutFill, finishRun };"
  );
  /* eslint-enable no-new-func */
  const api = build(chrome, () => {}); // importScripts is already inlined above

  return {
    api,
    badge,
    titles,
    injected,
    listeners,
    last: () => badge[badge.length - 1],
    lastTitle: () => titles[titles.length - 1]
  };
}

(async () => {
  // ---- A. the manifest declares it, with no extra permission -------------
  const command = (MANIFEST.commands || {})["fill-active-form"];
  t("A: the manifest declares the shortcut command", !!command);
  t(
    "A: Alt+Shift+F is the suggested key",
    !!command && command.suggested_key.default === "Alt+Shift+F",
    command && command.suggested_key.default
  );
  t(
    "A: the command is described for chrome://extensions",
    !!(command && command.description)
  );
  t(
    "A: the worker is registered",
    !!MANIFEST.background && MANIFEST.background.service_worker === "background.js",
    MANIFEST.background && MANIFEST.background.service_worker
  );
  t("A: background.js exists", exists("background.js"));
  t(
    "A: no new permission was needed (the command grants activeTab)",
    (MANIFEST.permissions || []).indexOf("tabs") === -1 &&
      (MANIFEST.permissions || []).indexOf("activeTab") >= 0,
    JSON.stringify(MANIFEST.permissions)
  );
  // The worker must importScripts() exactly the shared/ files, index.js first —
  // the same set the injected list names, so the cross-context module can never
  // drift between the worker, the pages and the injected run.
  const workerImports = (WORKER_SRC.match(/importScripts\(([\s\S]*?)\)/) || [])[1] || "";
  const importedFiles = (workerImports.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
  t(
    "A: the worker imports exactly the shared/ files, index.js first",
    importedFiles.join(",") === SHARED_SCRIPTS.join(","),
    importedFiles.join(", ")
  );

  // ---- B. nobody can drift on what gets injected -------------------------
  t("B: every listed content script exists", CONTENT_SCRIPTS.every(exists));
  t("B: the shared bootstrap is injected first", CONTENT_SCRIPTS[0] === "shared/index.js");
  t(
    "B: autofill.js is evaluated last",
    CONTENT_SCRIPTS[CONTENT_SCRIPTS.length - 1] === "content/autofill.js"
  );

  const pdom = new JSDOM(fs.readFileSync(path.join(APP_DIR, "popup.html"), "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const pw = pdom.window;
  pw.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} }
  };
  pw.eval(
    POPUP_JS +
      "\n; window.__t = { scripts: CONTENT_SCRIPTS, deadline: RUN_DEADLINE_MS," +
      " uiListsShared: CONTENT_SCRIPTS === JOB_AUTOFILL_SHARED.contentScripts };"
  );
  t(
    "B: the evaluated popup list IS the shared list",
    pw.__t.uiListsShared === true && JSON.stringify(pw.__t.scripts) === JSON.stringify(CONTENT_SCRIPTS)
  );

  // ---- C. the badge follows what is waiting for review -------------------
  const store = {
    jobProfile: {},
    learnedAnswers: {
      candidates: [
        { question: "Q1", value: "a", site: "", at: 1 },
        { question: "Q2", value: "b", site: "", at: 2 }
      ],
      skipped: []
    }
  };
  const control = {
    frames: 1,
    throws: null,
    tab: { id: 7, url: "https://boards.example.com/apply" }
  };
  const worker = loadWorker(store, control);
  await sleep(25);

  t(
    "B: the popup and the worker share one deadline",
    pw.__t.deadline === worker.api.state.deadlineMs,
    pw.__t.deadline
  );
  t("C: the badge counts the answers waiting for review", worker.last() === "2", worker.last());
  t(
    "C: the tooltip explains the badge",
    /2 answers you typed/.test(worker.lastTitle()),
    worker.lastTitle()
  );

  store.learnedAnswers.candidates = [];
  worker.listeners.storage({ learnedAnswers: { newValue: {} } }, "local");
  await sleep(25);
  t("C: clearing them clears the badge", worker.last() === "", JSON.stringify(worker.last()));
  t(
    "C: the empty badge still teaches the shortcut",
    /Alt\+Shift\+F/.test(worker.lastTitle()),
    worker.lastTitle()
  );

  store.learnedAnswers.candidates = [
    { question: "Q1", value: "a", site: "", at: 1 },
    { question: "Q2", value: "b", site: "", at: 2 }
  ];
  worker.listeners.storage({ learnedAnswers: { newValue: {} } }, "local");
  await sleep(25);

  // ---- D. the shortcut fills without ever opening the popup --------------
  worker.api.state.flashMs = 3000; // do not expire mid-assertion in parallel runs
  control.tab = { id: 7, url: "chrome://extensions" };
  worker.listeners.command("fill-active-form");
  await sleep(30);
  t(
    "D: a browser page is refused, and nothing is injected",
    worker.injected.length === 0 && worker.last() === "!",
    worker.last()
  );

  control.tab = { id: 7, url: "https://boards.example.com/apply" };
  control.frames = 2;
  worker.listeners.command("fill-active-form");
  await sleep(30);
  const options = worker.injected[worker.injected.length - 1];
  t(
    "D: the page is injected into EVERY frame",
    !!options && options.target.allFrames === true && options.target.tabId === 7,
    JSON.stringify(options && options.target)
  );
  t(
    "D: with the exact shared list, in order",
    !!options && JSON.stringify(options.files) === JSON.stringify(CONTENT_SCRIPTS)
  );
  t(
    "D: matchOriginAsFallback covers embedded frames",
    !!options && options.matchOriginAsFallback === true
  );
  t("D: the badge shows work in progress", worker.last() === "…", worker.last());

  worker.listeners.message(
    { type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 5 },
    { tab: { id: 7 } }
  );
  await sleep(20);
  t("D: one frame replying is not completion", worker.last() === "…", worker.last());
  worker.listeners.message(
    { type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 3 },
    { tab: { id: 7 } }
  );
  await sleep(20);
  t("D: every frame replying completes the run", worker.last() === "8", worker.last());
  t(
    "D: the tooltip reports the total",
    /Filled 8 fields/.test(worker.lastTitle()),
    worker.lastTitle()
  );

  worker.listeners.command("fill-active-form");
  await sleep(25);
  worker.listeners.message(
    { type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 99 },
    { tab: { id: 99 } }
  );
  await sleep(20);
  t("D: a result from another tab is ignored", worker.last() === "…", worker.last());
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 1 }, { tab: { id: 7 } });
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 1 }, { tab: { id: 7 } });
  await sleep(20);
  t("D: ...but this tab's own frames still count", worker.last() === "2", worker.last());

  // ---- E. the awkward cases ----------------------------------------------
  control.frames = 2;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "busy" }, { tab: { id: 7 } });
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "busy" }, { tab: { id: 7 } });
  await sleep(20);
  t("E: a 'busy' frame still counts as a reply", worker.last() === "0", worker.last());

  // A frame that never reports must not leave the badge hanging forever.
  // Freeze the result flash while asserting, so the deadline's number is not
  // overwritten by the "review count" fallback mid-check.
  worker.api.state.flashMs = 2000;
  worker.api.state.deadlineMs = 120;
  control.frames = 3;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 4 }, { tab: { id: 7 } });
  await sleep(220);
  t(
    "E: the deadline closes a run a frame never answered",
    worker.last() === "4",
    worker.last()
  );
  worker.api.state.flashMs = 120; // back to fast-forward for the owner test

  // An unknown URL is attempted rather than refused: activeTab may hide it.
  control.tab = { id: 8, url: undefined };
  control.frames = 1;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  t(
    "E: an unknown URL is attempted, not refused",
    worker.injected[worker.injected.length - 1].target.tabId === 8,
    JSON.stringify(worker.injected[worker.injected.length - 1].target)
  );
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 1 }, { tab: { id: 8 } });
  await sleep(20);

  // An injection that fails says so instead of pretending to work.
  control.tab = { id: 7, url: "https://boards.example.com/apply" };
  control.throws = "Cannot access contents of the page";
  worker.listeners.command("fill-active-form");
  await sleep(30);
  t("E: a refused injection reports a failure", worker.last() === "!", worker.last());
  t(
    "E: ...with advice the user can act on",
    /allow this site/.test(worker.lastTitle()),
    worker.lastTitle()
  );

  // Only one shortcut fill at a time.
  control.throws = null;
  control.frames = 1;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  const injectedBefore = worker.injected.length;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  t(
    "E: a second press mid-run is ignored",
    worker.injected.length === injectedBefore,
    worker.injected.length - injectedBefore
  );
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 2 }, { tab: { id: 7 } });
  await sleep(20);
  t("E: the run completes normally afterwards", worker.last() === "2", worker.last());

  // ---- F. the badge has exactly one owner --------------------------------
  // The flash window is set EXPLICITLY here: the earlier section shrank it to
  // 120 ms to prove the fallback, which is too tight to survive a 31-suite
  // parallel run (the flash could expire mid-assertion). A big window proves
  // the precedence, then a forced render with a tiny one proves the fallback.
  worker.api.state.flashMs = 3000;
  store.learnedAnswers.candidates = [{ question: "Q1", value: "a", site: "", at: 1 }];
  worker.listeners.storage({ learnedAnswers: { newValue: {} } }, "local");
  await sleep(25);
  t("F: a fresh result outranks the review count", worker.last() === "2", worker.last());
  worker.api.state.flashMs = 40;
  // A storage change forces a render, so the fallback never depends on a timer
  // that was scheduled with the OLD window.
  worker.listeners.storage({ learnedAnswers: { newValue: {} } }, "local");
  await sleep(150);
  t(
    "F: the review count takes over once the flash expires",
    worker.last() === "1",
    worker.last()
  );

  // ---- G. the shortcut also logs the application and the run ---------------
  // The shortcut is the fastest way to fill, so it must NOT lose your tracking:
  // it records the same log row and per-tab run the popup does, through the
  // shared implementation (no popup is open here).
  control.tab = { id: 7, url: "https://boards.example.com/apply" };
  control.frames = 1;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  worker.listeners.message(
    {
      type: "JOB_AUTOFILL_RESULT",
      status: "ok",
      filled: 4,
      scanned: 12,
      iframes: 0,
      unfilled: [{ label: "Portfolio", required: false, ref: "r1" }],
      page: {
        company: "Acme",
        role: "Engineer",
        url: "https://boards.example.com/apply",
        host: "boards.example.com"
      }
    },
    { tab: { id: 7 }, frameId: 0 }
  );
  await sleep(60);

  const apps = store.applications;
  t("G: the shortcut logged the application", !!apps && apps.items.length === 1, apps && apps.items.length);
  t(
    "G: with the page's company and role",
    !!apps && apps.items[0].company === "Acme" && apps.items[0].role === "Engineer"
  );
  t("G: as 'in progress', not applied", !!apps && apps.items[0].status === "in progress");

  const rec = store.lastRuns && store.lastRuns["7"];
  t("G: the shortcut stored the run for its tab", !!rec);
  t(
    "G: keeping the 'fields left for you' list",
    !!rec && Array.isArray(rec.results.unfilled) && rec.results.unfilled.length === 1
  );
  t(
    "G: so reopening the popup can rebuild it",
    !!rec && !!rec.page && rec.page.company === "Acme" && rec.page.role === "Engineer"
  );

  control.frames = 2;
  worker.listeners.command("fill-active-form");
  await sleep(25);
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 0,
    scanned: 0, iframes: 1, page: rec.page, unfilled: [] }, { tab: { id: 7 }, frameId: 0 });
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 2,
    scanned: 9, unfilled: [{ label: "Iframe question", ref: "inner-ref", required: true }] },
    { tab: { id: 7 }, frameId: 12 });
  await sleep(60);
  const embedded = store.lastRuns["7"].results;
  t("G: shortcut remembers embedded-frame fields", embedded.unfilled[0].label === "Iframe question");
  t("G: preserving the frame identity", embedded.unfilled[0].frameId === 12);
  t("G: sums scan counts from every frame", embedded.scanned === 9);
  t("G: preserves actual frame replies", embedded.frames === 2);

  // No popup listener exists: the worker must finish and persist a popup-started run itself.
  const request = message => new Promise(resolve => worker.listeners.message(message, {}, resolve));
  control.frames = 2;
  const started = await request({ type: "JOB_AUTOFILL_START", tabId: 7 });
  t("H: popup delegates its run to the worker", started.ok && !!started.id);
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 1,
    scanned: 1, page: { company: "Example", role: "New role", url: "https://boards.example.com/new" }, unfilled: [] },
    { tab: { id: 7 }, frameId: 0 });
  worker.listeners.message({ type: "JOB_AUTOFILL_RESULT", status: "ok", filled: 2,
    scanned: 3, unfilled: [{ label: "Required question", ref: "remaining", required: true }] },
    { tab: { id: 7 }, frameId: 3 });
  const popupRecord = await request({ type: "JOB_AUTOFILL_RECORD", id: started.id });
  t("H: popup closure loses no application record", store.applications.items.some(item => item.role === "New role"));
  t("H: popup closure loses no remaining-field record", popupRecord.results.unfilled[0].ref === "remaining");
  t("H: worker sums all popup frames", popupRecord.results.filled === 3 && popupRecord.results.frames === 2);
  t("H: the worker exposes matching cover-letter metadata", popupRecord.results.page.url === popupRecord.page.url);
  t("H: content frames cannot start destructive fills", worker.listeners.message(
    { type: "JOB_AUTOFILL_START", tabId: 7, approveDeletion: true }, { tab: { id: 7 } }, () => {}) === undefined);

  console.log(
    `\n${
      fail === 0 ? "SHORTCUT+BADGE E2E PASS" : "SHORTCUT+BADGE E2E FAIL"
    } (${pass} passed, ${fail} failed)`
  );
  process.exit(fail === 0 ? 0 : 1);
})();



