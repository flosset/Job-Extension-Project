// fill-runner.js — runs a fill: injects the content scripts into the active tab
// and every frame, aggregates the per-frame results, and renders the outcome.

"use strict";

// Completion model -----------------------------------------------------------
// A frame is a KNOWN quantity: chrome.scripting.executeScript resolves with one
// InjectionResult per frame it injected into, so we wait for EVERY expected
// frame to report instead of guessing completion from a quiet gap. A frame
// that spends seconds working (waitForFields, dropdown waits) can therefore no
// longer have its result silently dropped. A hard deadline covers frames that
// never report, and that shortfall is reported to the user rather than hidden.
// The whole run's deadline lives in shared.js so the popup and the service
// worker cannot disagree about how long a fill may take.
const RUN_DEADLINE_MS = JOB_AUTOFILL_SHARED.runDeadlineMs;
const FRAME_GRACE_MS = 250;    // settle time once every expected frame replied

const aggregate = {
  active: false,
  results: null,
  expected: null,   // how many frames executeScript injected into
  timer: null,
  deadline: null,
  deadlineMs: RUN_DEADLINE_MS, // overridable so tests need not wait 15s
  graceMs: FRAME_GRACE_MS,

  start() {
    this.cancel();
    this.active = true;
    this.expected = null;
    this.results = {
      filled: 0, attached: 0, kept: 0, zones: 0, acknowledged: 0,
      removed: 0, surplus: 0,
      flagged: 0, unfilled: [],
      frames: 0, contributingFrames: 0, iframes: 0,
      sawEmpty: false, sawError: false, sawBusy: false, scanned: 0,
      // Repeatable sections the fill could not address at all (so the user is
      // told rather than left with an empty block they cannot explain).
      sectionIssues: [],
      // What this page is an application for (top frame only) — filled in by
      // autofill.js from JA.pageInfo().
      page: null
    };
    const list = $("unfilledList");
    if (list) list.innerHTML = "";
    this.deadline = setTimeout(() => this.flush(true), this.deadlineMs);
  },

  /** Called once executeScript tells us how many frames it reached. */
  setExpected(count) {
    if (!this.active) return;
    this.expected = Number(count) || 0;
    this.maybeFlush();
  },

  add(message) {
    if (!this.active || !this.results) return;
    this.results.frames++;
    this.results.scanned += Number(message.scanned) || 0;
    // Only the top frame reports this, so the first non-empty one wins.
    if (!this.results.page && message.page) this.results.page = message.page;
    if (Array.isArray(message.sectionIssues)) {
      for (const section of message.sectionIssues) {
        if (section && this.results.sectionIssues.indexOf(section) === -1) {
          this.results.sectionIssues.push(section);
        }
      }
    }
    this.results.iframes = Math.max(
      this.results.iframes,
      Number(message.iframes) || 0
    );

    if (message.status === "empty") {
      this.results.sawEmpty = true;
    } else if (message.status === "ok") {
      const n = Number(message.filled) || 0;
      this.results.filled += n;
      this.results.flagged += Number(message.flagged) || 0;
      this.results.attached += Number(message.attached) || 0;
      this.results.kept += Number(message.kept) || 0;
      this.results.zones += Number(message.zones) || 0;
      this.results.acknowledged += Number(message.acknowledged) || 0;
      this.results.removed += Number(message.removed) || 0;
      this.results.surplus += Number(message.surplus) || 0;
      if (Array.isArray(message.unfilled)) {
        for (const label of message.unfilled) {
          if (label && this.results.unfilled.indexOf(label) === -1) {
            this.results.unfilled.push(label);
          }
        }
      }
      if (n > 0) this.results.contributingFrames++;
    } else if (message.status === "busy") {
      this.results.sawBusy = true; // a frame was still working — not an error
    } else {
      this.results.sawError = true;
    }

    this.maybeFlush();
  },

  /**
   * Render only when EVERY expected frame has replied, plus a short grace so
   * in-flight duplicates still land. Until then keep the user informed.
   */
  maybeFlush() {
    if (!this.active || !this.results) return;
    if (this.expected === null) return; // frame count not known yet
    if (this.results.frames < this.expected) {
      this.progress();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(false), this.graceMs);
  },

  /** Live "how many frames still to answer" feedback. */
  progress() {
    setStatus(
      `Scanning page and frames... (${this.results.frames}/${this.expected} replied)`,
      ""
    );
  },

  flush(timedOut) {
    if (!this.active || !this.results) return;
    const r = this.results;
    const expected = this.expected;
    // A frame that never answered is surfaced rather than silently ignored.
    const missing =
      timedOut && expected !== null && r.frames < expected
        ? ` (${expected - r.frames} frame${expected - r.frames === 1 ? "" : "s"} did not respond)`
        : "";
    this.active = false;
    this.results = null;
    this.expected = null;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);

    // Is this a job we have applied to before? Decided from the log as it was
    // BEFORE this fill, so a run can never report itself as its own duplicate.
    const page = r.page;
    let duplicate = null;
    if (page && typeof previousApplication === "function") {
      const previous = previousApplication(page);
      if (previous && previous.entry) {
        duplicate = {
          level: previous.level,
          company: previous.entry.company,
          role: previous.entry.role,
          at: previous.entry.lastAt || previous.entry.at
        };
      }
    }

    // Is this run an application worth logging? A page with no form at all, or
    // one where there was no profile to fill with, is not an application.
    const willLog = !!(
      page &&
      !r.sawEmpty &&
      (r.filled > 0 || r.attached > 0 || r.flagged > 0 || r.scanned > 0)
    );

    if (r.sawEmpty) {
      setStatus("No saved profile yet — fill it in and press Save first.", "warn");
    } else if (r.filled > 0) {
      const frames = r.contributingFrames > 1 ? ` across ${r.contributingFrames} frames` : "";
      const file = r.attached > 0
        ? " 📎 Resume attached."
        : r.flagged > 0
        ? ` 📎 ${r.flagged} resume drop zone${r.flagged === 1 ? "" : "s"} flagged.`
        : "";
      setStatus(`⚡ Filled ${r.filled} field${r.filled === 1 ? "" : "s"}${frames}.${file}`, "ok");
    } else if (r.attached > 0) {
      setStatus("📎 Resume attached to the application.", "ok");
    } else if (r.flagged > 0) {
      setStatus(`📎 Resume drop zone flagged — drag & drop your file.`, "ok");
    } else if (r.sawError && r.filled === 0) {
      setStatus("⚠️ Autofill hit an error on this page.", "error");
    } else if (r.frames > 0) {
      const frames = `${r.frames} frame${r.frames === 1 ? "" : "s"}`;
      setStatus(`No matching fields. Scanned ${r.scanned} fields across ${frames}.`, "");
    } else {
      setStatus("⚠️ Autofill could not complete.", "error");
    }

    renderUnfilled(r.unfilled);

    // Extras appended to whatever the status line already says, so none of
    // them needs its own branch in the chain above.
    const notes = [];

    // The duplicate warning comes first: it is the reason the user needs to
    // read this line at all.
    if (duplicate) {
      notes.push(duplicateNote(duplicate));
    } else if (willLog) {
      notes.push("📋 Logged to your applications — mark it applied once you submit.");
    }
    if (missing) notes.push(missing.trim());

    // A section we could not address is said out loud: an empty "Education"
    // block the user cannot explain is worse than being told it was not
    // recognised (and that nothing was added).
    if (r.sectionIssues && r.sectionIssues.length > 0) {
      notes.push(
        `⚠️ Could not fill ${r.sectionIssues.join(" or ")} — that widget was not ` +
          "recognised, so nothing was added."
      );
    }

    // An attachment we deliberately left alone — the user's own file, kept.
    if (r.kept > 0) {
      notes.push(`Kept your existing attachment${r.kept === 1 ? "" : "s"}.`);
    }

    // Bytes were written but the widget never showed the file — say so rather
    // than claiming the upload succeeded.
    if (r.attached > 0 && r.zones > 0 && r.acknowledged === 0) {
      notes.push("Please confirm the upload stuck.");
    }

    // Leftover history blocks: say what was removed, or that some were left.
    if (r.removed > 0) {
      notes.push(
        `Removed ${r.removed} leftover history block${r.removed === 1 ? "" : "s"}.`
      );
    }
    if (r.surplus > 0 && r.removed === 0) {
      notes.push(
        `${r.surplus} leftover history block${r.surplus === 1 ? "" : "s"} left untouched.`
      );
    }

    // Part of the page may be in a frame we were not allowed to reach — an
    // embedded ATS whose domain is not in our pre-listed hosts. Offer the
    // optional broad-access permission instead of failing silently.
    const unreachable = r.iframes > 0 && r.frames < 1 + r.iframes;
    if (unreachable && r.filled === 0) {
      notes.push("Part of this page is in a frame I could not reach.");
    }
    showGrantRow(unreachable);

    if (notes.length > 0) {
      const status = $("status");
      if (status) status.textContent += " " + notes.join(" ");
    }

    // Remember this run for its tab (the list vanishes with the popup document),
    // log the application, and — when the page never told us which job this is —
    // ASK, rather than filing a nameless row. `willLog` was decided above, BEFORE
    // the duplicate warning, so this run can never appear to be its own duplicate.
    finishRun(r, { page, duplicate, willLog });
  },

  cancel() {
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.active = false;
    this.results = null;
    this.expected = null;
  }
};

/**
 * Inject autofill.js into the top frame and every subframe.
 * activeTab covers the top frame's origin; host_permissions cover the
 * cross-origin ATS subframes (e.g. boards.greenhouse.io embedded in a
 * pinterestcareers.com page). matchOriginAsFallback additionally covers
 * about:blank / blob: / data: frames that inherit the embedder's origin;
 * Chrome builds that reject that property fall back to a plain allFrames run.
 */
async function injectIntoAllFrames(tabId) {
  const target = { tabId, allFrames: true };
  try {
    return await chrome.scripting.executeScript({
      target,
      files: CONTENT_SCRIPTS,
      matchOriginAsFallback: true
    });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/matchOriginAsFallback/i.test(message)) {
      return await chrome.scripting.executeScript({ target, files: CONTENT_SCRIPTS });
    }
    throw err;
  }
}

// Note: the popup no longer edits the profile, so "save before you fill" can no
// longer be forgotten — the full editor auto-saves (and flushes the moment its
// tab is hidden) before the popup can be clicked.

/** The tab we last filled, so the field list can message it. */
let activeTabId = null;

/** Inject the fill content script into the active tab and all of its frames. */
async function fillActiveTab() {
  // A destructive run is confirmed every single time — never silently.
  const replaceBox = $("replaceHistory");
  if (replaceBox && replaceBox.checked) {
    const proceed =
      typeof window.confirm !== "function" ||
      window.confirm(
        "Remove leftover work/education blocks on the page?\n\n" +
          "Every history block beyond your saved entries will be DELETED from " +
          "the form. Your saved profile is not affected."
      );
    if (!proceed) {
      setStatus("Cancelled — nothing was changed.", "warn");
      return;
    }
  }
  setStatus("⏳ Scanning page and frames…", "");
  aggregate.start();

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab && typeof tab.id === "number" ? tab.id : null;
  } catch (err) {
    aggregate.cancel();
    setStatus("⚠️ Could not query the active tab.", "warn");
    return;
  }

  if (!tab || typeof tab.id !== "number") {
    aggregate.cancel();
    setStatus("⚠️ No active tab available.", "warn");
    return;
  }

  try {
    const injected = await injectIntoAllFrames(tab.id);
    // Now that we know how many frames were reached, completion is defined:
    // render once every one of them has reported (or the deadline expires).
    aggregate.setExpected(Array.isArray(injected) ? injected.length : 1);
  } catch (err) {
    // Some pages reject allFrames injection; fall back to the top frame only
    // before giving up (e.g. restricted/sandboxed subframes).
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPTS
      });
      aggregate.setExpected(Array.isArray(injected) ? injected.length : 1);
    } catch (err2) {
      aggregate.cancel();
      setStatus("⚠️ Cannot run on this page (browser/system page).", "warn");
    }
  }
}

/** Handle a result message sent back by an injected autofill.js. */
function onAutofillResult(message) {
  if (!message || message.type !== "JOB_AUTOFILL_RESULT") return;
  aggregate.add(message);
}

/** Small helper to write the status line with a style class. */
function setStatus(text, kind) {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.className = kind || "";
}

/** Origin pattern for the optional "fill anywhere" permission. */
const ANY_SITE_ORIGINS = ["*://*/*"];

/**
 * Offer the optional broad host access when part of the page is in a frame we
 * could not reach (an embedded ATS whose domain is not pre-listed). Purely
 * opt-in: nothing is requested until the user clicks, and the extension still
 * does nothing until Fill is pressed.
 */
async function showGrantRow(want) {
  const row = $("grantRow");
  if (!row) return;
  if (!want || !chrome.permissions) {
    row.hidden = true;
    return;
  }
  try {
    const already = await chrome.permissions.contains({
      origins: ANY_SITE_ORIGINS
    });
    if (already) {
      row.hidden = true;
      return;
    }
  } catch (err) {
    /* permissions API unavailable — still offer the button */
  }
  row.hidden = false;
}

/** Ask for broad host access, then tell the user to press Fill again. */
async function requestAnySiteAccess() {
  try {
    const granted = await chrome.permissions.request({
      origins: ANY_SITE_ORIGINS
    });
    if (granted) {
      const row = $("grantRow");
      if (row) row.hidden = true;
      setStatus("✅ Access granted — press Fill again to fill the embedded frame.", "ok");
    } else {
      setStatus("Access not granted — the embedded frame will stay unfilled.", "warn");
    }
  } catch (err) {
    setStatus("⚠️ Could not request permission on this page.", "error");
  }
}

/** List the fields we could not fill, so the user knows what is left. */
/** Ask the page to scroll to and flash one of the fields left for you. */
async function locateField(ref, li) {
  if (!ref) return;
  if (li) {
    li.classList.add("locating");
    setTimeout(() => li.classList.remove("locating"), 900);
  }
  if (typeof activeTabId !== "number") return;
  try {
    // Rejects when no content script answers, i.e. the page was reloaded or
    // navigated since that fill and its stored handles no longer exist. Say so
    // rather than looking like a dead click.
    await chrome.tabs.sendMessage(activeTabId, { type: "JOB_AUTOFILL_LOCATE", ref });
  } catch (err) {
    setStatus("That page has changed since the fill — press Fill Application again.", "warn");
  }
}

/**
 * List the fields we could not fill — required ones first, each clickable so
 * the user can jump straight to it on the page.
 */
function renderUnfilled(entries) {
  const list = $("unfilledList");
  if (!list) return;
  list.innerHTML = "";

  const items = (Array.isArray(entries) ? entries : []).map((entry) =>
    typeof entry === "string" ? { label: entry, required: false, ref: null } : entry
  );
  if (items.length === 0) return;

  // Required fields block submission, so they come first.
  const sorted = items
    .slice()
    .sort((a, b) => Number(!!b.required) - Number(!!a.required));
  const requiredCount = sorted.filter((entry) => entry.required).length;

  const header = document.createElement("li");
  header.className = "more";
  header.textContent = requiredCount
    ? `${sorted.length} field${sorted.length === 1 ? "" : "s"} left for you (${requiredCount} required):`
    : `${sorted.length} field${sorted.length === 1 ? "" : "s"} left for you:`;
  list.appendChild(header);

  const shown = sorted.slice(0, 6);
  for (const entry of shown) {
    const li = document.createElement("li");
    if (entry.required) li.className = "req";
    li.textContent = (entry.required ? "★ " : "") + entry.label;
    if (entry.ref) {
      li.title = "Click to highlight this field on the page";
      li.tabIndex = 0;
      li.addEventListener("click", () => locateField(entry.ref, li));
    }
    list.appendChild(li);
  }
  if (sorted.length > shown.length) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = `…and ${sorted.length - shown.length} more`;
    list.appendChild(more);
  }
}

// --- The remembered run, per tab -------------------------------------------
// The popup is a brand-new document every time it opens, so anything rendered
// from a live message is gone the instant it closes — which is exactly when the
// user needs it, because they close the popup to go and fill those fields by
// hand. A finished run is therefore stored per tab and rebuilt on the next open.
// It holds field labels only, and `Delete all` clears it with everything else.

async function readRuns() {
  try {
    const data = await chrome.storage.local.get(RUNS_KEY);
    const raw = data && data[RUNS_KEY];
    return raw && typeof raw === "object" ? raw : {};
  } catch (err) {
    return {};
  }
}

/** Store a finished run under its tab (the shared rule, so the worker agrees). */
async function saveRun(tabId, results, extra) {
  await JOB_AUTOFILL_SHARED.saveRunRecord(tabId, results, extra);
}

/** Log a finished application, so a later visit to the same job can warn you. */
async function logRun(page) {
  try {
    if (typeof recordApplication !== "function") return null;
    const result = await recordApplication(page);
    // recordApplication reports { entry, isNew, repeated } — the ask hangs off
    // the entry itself, so unwrap it here rather than at every call site.
    return (result && result.entry) || null;
  } catch (err) {
    /* the log is a convenience — it must never break a fill */
  }
  return null;
}

/**
 * Persist everything a finished run produced, in one place: the list for this
 * tab, the application log, and — when the page could not name the job — the one
 * question worth asking. Answered by the user, never guessed: the row keeps
 * whatever the page gave, and the ask is closed as soon as they answer it.
 */
async function finishRun(results, info) {
  const page = info.page;
  let ask = null;

  if (info.willLog) {
    const entry = await logRun(page);
    if (entry && (!entry.company || !entry.role)) {
      ask = {
        id: entry.id,
        company: entry.company || "",
        role: entry.role || ""
      };
    }
  }

  if (ask && typeof showJobAsk === "function") {
    showJobAsk(ask);
  }
  await saveRun(activeTabId, results, { page, duplicate: info.duplicate, ask });
}

/**
 * The tab's question has been answered (saved or waved off). Forget it for this
 * run so reopening the popup does not ask again — a new Fill starts a new run,
 * and is allowed to ask again.
 */
async function markAskAnswered() {
  if (typeof activeTabId !== "number") return;
  const runs = await readRuns();
  const record = runs[String(activeTabId)];
  if (!record || !record.ask) return;
  record.ask = null;
  try {
    await chrome.storage.local.set({ [RUNS_KEY]: runs });
  } catch (err) {
    /* not remembering the answer is a nuisance, not a failure */
  }
}

/** Rebuild the "fields left for you" list for the active tab, if we have one. */
async function restoreRun() {
  if (!$("unfilledList")) return; // the list only exists on the popup screen
  if (aggregate.active) return; // a fill is already reporting into it

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return;
  }
  if (!tab || typeof tab.id !== "number") return;

  const runs = await readRuns();
  const record = runs[String(tab.id)];
  const results = record && record.results;
  if (!results) return;
  // A stale record describes a page that has almost certainly changed since.
  if (typeof record.at !== "number" || record.at < Date.now() - JOB_AUTOFILL_SHARED.runMaxAgeMs) {
    return;
  }

  const list = Array.isArray(results.unfilled) ? results.unfilled : [];
  // An unanswered "which job is this?" is re-shown too: the popup closes on any
  // click, so the question has to outlive the document that asked it.
  const ask = record.ask && record.ask.id ? record.ask : null;
  // Nothing left to show, nothing to warn about, nothing to ask: say nothing.
  if (list.length === 0 && !record.duplicate && !ask) return;

  // Point click-to-locate back at this tab: the stored handles are only useful
  // if we know where to send them. The ask needs it too, to close itself.
  activeTabId = tab.id;
  if (ask && typeof showJobAsk === "function") {
    showJobAsk(ask);
  }
  if (list.length > 0) {
    renderUnfilled(list);
    showGrantRow(results.iframes > 0 && results.frames < 1 + results.iframes);
    setStatus(
      `Left for you after your fill at ${formatTime(record.at)} — ` +
        "press Fill Application to re-check.",
      ""
    );
  }

  // The warning this run produced is re-shown too, so reopening the popup does
  // not quietly hide the fact that you have applied here before.
  if (record.duplicate) {
    const el = $("status");
    if (el) {
      el.textContent =
        (el.textContent ? el.textContent + " " : "") + duplicateNote(record.duplicate);
      el.className = "warn";
    }
  }
}

/**
 * One line for a duplicate finding. "same" is definite (the posting URL
 * matches); "possible" is only a warning — the same company and role, which may
 * well be two different postings.
 */
function duplicateNote(dup) {
  const when = formatWhen(dup.at);
  if (dup.level === "possible") {
    return (
      "⚠️ Possible repeat — you may have applied to " +
      `"${dup.role || "this role"}" at ${dup.company || "this company"} on ${when}.`
    );
  }
  return `⚠️ Already applied here on ${when}.`;
}

/**
 * Warn the moment the popup opens, BEFORE any fill: if this tab's URL is a
 * posting already in the log, say so up front. That is what makes the "warned
 * about before you fill it again" promise real — it reads the log as it stands,
 * with no injection at all. (The fill later re-checks with the company + role
 * the page reports, which can only ever add a "possible" warning.)
 */
async function checkDuplicateOnOpen() {
  if (typeof previousApplication !== "function") return;
  let url = "";
  try {
    if (typeof loadApplications === "function") await loadApplications();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    url = (tab && tab.url) || "";
  } catch (err) {
    return; // no tabs access here (e.g. the options page) — nothing to check
  }
  if (!url || !/^https?:/i.test(url)) return;
  const seen = previousApplication({ url });
  if (!seen || !seen.entry) return;
  const el = $("status");
  if (!el) return;
  const when = formatWhen(seen.entry.lastAt || seen.entry.at);
  el.textContent =
    seen.level === "same"
      ? `⚠️ You have already applied to this posting (${when}).`
      : "⚠️ You may have already applied to " +
        `"${seen.entry.role || "this role"}" at ` +
        `${seen.entry.company || "this company"} (${when}).`;
  el.className = "warn";
}

/** Local wall-clock time for a stored timestamp. */
function formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (err) {
    return "earlier";
  }
}
