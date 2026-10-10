// fill-aggregate.js — the per-frame completion model. A frame is a KNOWN
// quantity: chrome.scripting.executeScript resolves with one result per frame
// it injected into, so a fill is complete when EVERY expected frame has
// reported (or the deadline expires) — never guessed from a quiet gap.

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
// The whole run's deadline lives in shared/ so the popup and the service
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