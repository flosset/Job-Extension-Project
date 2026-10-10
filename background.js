// background.js — the MV3 service worker. It exists for exactly two reasons.
//
//   1. The keyboard shortcut (Alt+Shift+F). A popup cannot be opened by a
//      shortcut, so starting a fill has to be possible from outside it: the
//      worker injects the same content scripts the popup injects, and the page
//      then fills itself. The command counts as a user gesture, so activeTab is
//      granted and no extra permission is needed.
//   2. The toolbar badge. It is the only persistent "there is something to do"
//      signal we have without a popup — the number of answers learned from
//      typing that are waiting to be reviewed.
//
// Nothing here reads a page's content, and nothing leaves the browser.
//
// Completion is defined exactly the way the popup defines it: executeScript
// tells us how many frames it reached, so we wait for EVERY one of them to
// report (or for the deadline) rather than guessing from a quiet gap.

importScripts("shared.js"); // the ONE content-script list + storage keys

const KEYS = JOB_AUTOFILL_SHARED.keys;
const SCRIPTS = JOB_AUTOFILL_SHARED.contentScripts;
const COMMAND = "fill-active-form";

/**
 * All mutable state lives in one object: the badge has a single owner (render),
 * and a test can fast-forward the timings without patching globals.
 */
const state = {
  pending: 0,  // answers waiting to be reviewed
  flash: null, // the transient badge (a fill result), if any
  run: null,   // the in-flight shortcut run, if any
  deadlineMs: JOB_AUTOFILL_SHARED.runDeadlineMs,
  flashMs: 5000
};

function setBadge(text, color, title) {
  try {
    chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
    if (title) chrome.action.setTitle({ title });
  } catch (err) {
    /* the badge is cosmetic — it must never break a fill */
  }
}

/** The badge shows one thing at a time: a fresh result, else the review count. */
function render() {
  const flash = state.flash;
  if (flash && Date.now() - flash.at < state.flashMs) {
    setBadge(flash.text, flash.color, flash.title);
    setTimeout(render, state.flashMs + 50); // fall back once it expires
    return;
  }
  if (state.pending > 0) {
    setBadge(
      String(state.pending),
      "#b45309",
      `${state.pending} answer${state.pending === 1 ? "" : "s"} you typed can be ` +
        "saved to your answer bank — open the popup to review them"
    );
    return;
  }
  setBadge("", "", "Private Job Autofill — press Alt+Shift+F to fill this application");
}

/** Count what is waiting for review and show it. */
async function refreshPending() {
  try {
    const data = await chrome.storage.local.get(KEYS.learned);
    state.pending = JOB_AUTOFILL_SHARED.sanitizeLearned(
      data && data[KEYS.learned]
    ).candidates.length;
  } catch (err) {
    state.pending = 0;
  }
  render();
}

/** Show a short-lived badge message; the review count returns when it expires. */
function flashResult(text, color, title) {
  state.flash = { text, color, title, at: Date.now() };
  render();
}

/** Inject the content scripts into every frame, exactly like the popup does. */
async function injectAllFrames(tabId) {
  const target = { tabId, allFrames: true };
  try {
    return await chrome.scripting.executeScript({
      target,
      files: SCRIPTS,
      matchOriginAsFallback: true
    });
  } catch (err) {
    // Chrome builds without matchOriginAsFallback: retry plainly.
    const message = String((err && err.message) || err);
    if (/matchOriginAsFallback/i.test(message)) {
      return await chrome.scripting.executeScript({ target, files: SCRIPTS });
    }
    throw err;
  }
}

function finishRun(run) {
  if (state.run !== run) return; // a newer run replaced it
  clearTimeout(run.timer);
  state.run = null;
  if (run.filled > 0) {
    flashResult(
      String(run.filled),
      "#0b7a3b",
      `Filled ${run.filled} field${run.filled === 1 ? "" : "s"} on this application`
    );
  } else {
    flashResult(
      "0",
      "#8a909c",
      "Nothing to fill here — open the popup for the details"
    );
  }
  // Using the shortcut must NOT lose your tracking: log the application and
  // store the run for this tab, exactly as the popup does (best-effort — the
  // badge above is already shown either way).
  recordShortcutRun(run).catch(() => {});
}

/**
 * Record what a shortcut fill produced — the application log and the per-tab
 * "fields left for you" list — through the SHARED implementation, so the popup
 * and the worker can never drift. The worker has no DOM, so it never touches
 * the popup's display code.
 */
async function recordShortcutRun(run) {
  const top = run.top;
  if (!top || !top.page) return;
  const results = {
    unfilled: run.unfilled,
    iframes: run.iframes,
    frames: run.replies,
    scanned: run.scanned,
    filled: run.filled,
    ...run.counts,
    sectionIssues: run.sectionIssues
  };

  let items = [];
  try {
    const data = await chrome.storage.local.get(KEYS.applications);
    items = JOB_AUTOFILL_SHARED.sanitizeApplications(
      data && data[KEYS.applications]
    ).items;
  } catch (err) {
    items = [];
  }
  const previous = JOB_AUTOFILL_SHARED.findPreviousApplication(top.page, items);
  const duplicate = previous
    ? {
        level: previous.level,
        company: previous.entry.company,
        role: previous.entry.role,
        at: previous.entry.lastAt || previous.entry.at
      }
    : null;

  const willLog = !run.sawEmpty && (run.filled > 0 || results.scanned > 0 || results.attached > 0 || results.flagged > 0);
  let ask = null;
  if (willLog) {
    const logged = await JOB_AUTOFILL_SHARED.logApplication(top.page);
    const entry = logged && logged.entry;
    if (entry && (!entry.company || !entry.role)) {
      ask = { id: entry.id, company: entry.company || "", role: entry.role || "" };
    }
  }
  await JOB_AUTOFILL_SHARED.saveRunRecord(run.tabId, results, {
    page: top.page,
    duplicate,
    ask
  });
}

/** Every expected frame has replied — the run is over. */
function finishIfComplete(run) {
  if (run.expected !== null && run.replies >= run.expected) finishRun(run);
}

/** The Alt+Shift+F path: fill the active tab without ever opening the popup. */
async function startShortcutFill() {
  if (state.run) return; // one shortcut fill at a time

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return;
  }
  if (!tab || typeof tab.id !== "number") {
    flashResult("!", "#b91c1c", "There is no page to fill — open the application first");
    return;
  }
  // The URL is only known when activeTab applies; if it is missing, let the
  // injection decide and report a real error rather than guessing.
  const url = (tab && tab.url) || "";
  if (url && !/^https?:/i.test(url)) {
    flashResult(
      "!",
      "#b91c1c",
      "This page cannot be filled — open the job application first"
    );
    return;
  }

  const run = {
    tabId: tab.id,
    expected: null,
    replies: 0,
    filled: 0,
    errors: 0,
    scanned: 0,
    iframes: 0,
    unfilled: [],
    counts: { attached: 0, flagged: 0, kept: 0, zones: 0, acknowledged: 0, removed: 0, surplus: 0 },
    sectionIssues: [],
    sawEmpty: false,
    top: null,   // the top frame's report: page, unfilled, counts
    timer: null
  };
  state.run = run;
  flashResult("…", "#2563eb", "Filling this application…");

  try {
    const injected = await injectAllFrames(tab.id);
    run.expected = Array.isArray(injected) ? injected.length : 1;
  } catch (err) {
    state.run = null;
    flashResult(
      "!",
      "#b91c1c",
      "Cannot fill this page — open the popup once to allow this site, then try again"
    );
    return;
  }

  run.timer = setTimeout(() => finishRun(run), state.deadlineMs);
  finishIfComplete(run);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === COMMAND) startShortcutFill();
});

// Results arrive from the injected autofill.js in every frame. "busy" counts as
// a reply (executeScript reached that frame too), so the run can still complete.
chrome.runtime.onMessage.addListener((message, sender) => {
  const run = state.run;
  if (!run || !message || message.type !== "JOB_AUTOFILL_RESULT") return;
  if (!sender || !sender.tab || sender.tab.id !== run.tabId) return;
  run.replies++;
  run.scanned += Number(message.scanned) || 0;
  run.iframes = Math.max(run.iframes, Number(message.iframes) || 0);
  if (message.status === "ok" && Array.isArray(message.unfilled)) {
    for (const field of message.unfilled) {
      run.unfilled.push(typeof field === "object"
        ? Object.assign({}, field, { frameId: sender.frameId })
        : { label: field, required: false, frameId: sender.frameId });
    }
  }
  if (message.status === "ok") {
    for (const key of Object.keys(run.counts)) run.counts[key] += Number(message[key]) || 0;
    for (const issue of message.sectionIssues || []) {
      if (!run.sectionIssues.includes(issue)) run.sectionIssues.push(issue);
    }
    run.filled += Number(message.filled) || 0;
  } else if (message.status === "error") {
    run.errors++;
  } else if (message.status === "empty") {
    run.sawEmpty = true;
  }
  // The top frame (frameId 0) is the one that reports which job this is and the
  // list of fields left for you.
  if (sender.frameId === 0 && message.page) run.top = message;
  finishIfComplete(run);
});

// The badge follows the pending-review count, wherever that is written.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[KEYS.learned]) return;
  refreshPending();
});
chrome.runtime.onInstalled.addListener(refreshPending);
chrome.runtime.onStartup.addListener(refreshPending);
refreshPending();

