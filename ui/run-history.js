// run-history.js — the remembered run, per tab: what the last fill left for
// you, the application-log entry it wrote, the "which job is this?" question,
// and the duplicate warning. The popup is a fresh document on every open, so
// all of it is stored per tab and rebuilt on the next open.


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