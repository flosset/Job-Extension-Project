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
      sawEmpty: false, sawError: false, sawBusy: false, scanned: 0
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
    if (missing) notes.push(missing.trim());

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

    // Remember this run for its tab. The popup document is destroyed the moment
    // it closes — and the user closes it precisely to go and fill these fields
    // by hand — so without this the list would vanish exactly when it is useful.
    saveRun(activeTabId, r);
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

/** Store a finished run under its tab, pruning expired and extra records. */
async function saveRun(tabId, results) {
  if (typeof tabId !== "number" || !results) return;
  const runs = await readRuns();
  const cutoff = Date.now() - JOB_AUTOFILL_SHARED.runMaxAgeMs;
  const record = { tabId, at: Date.now(), results };

  // Keep only recent records, and never prune the one just written.
  const older = [];
  for (const key of Object.keys(runs)) {
    const kept = runs[key];
    if (kept && typeof kept.at === "number" && kept.at >= cutoff && kept.tabId !== tabId) {
      older.push(kept);
    }
  }
  older.sort((a, b) => b.at - a.at);

  const pruned = {};
  for (const kept of [record].concat(older.slice(0, JOB_AUTOFILL_SHARED.maxRuns - 1))) {
    pruned[String(kept.tabId)] = kept;
  }
  try {
    await chrome.storage.local.set({ [RUNS_KEY]: pruned });
  } catch (err) {
    /* remembering the list is a convenience — never let it break a fill */
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
  if (!results || !Array.isArray(results.unfilled) || results.unfilled.length === 0) {
    return;
  }
  // A stale record describes a page that has almost certainly changed since.
  if (typeof record.at !== "number" || record.at < Date.now() - JOB_AUTOFILL_SHARED.runMaxAgeMs) {
    return;
  }

  // Point click-to-locate back at this tab: the stored handles are only useful
  // if we know where to send them.
  activeTabId = tab.id;
  renderUnfilled(results.unfilled);
  showGrantRow(results.iframes > 0 && results.frames < 1 + results.iframes);
  setStatus(
    `Left for you after your fill at ${formatTime(record.at)} — ` +
      "press Fill Application to re-check.",
    ""
  );
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
