// tracker.js — the application log: company / role / URL / date, so a repeat
// application can be caught BEFORE the form is filled again.
//
// Identity is "same company AND same role" (legal-form insensitive), or the same
// posting URL. A different role at the same company is a different application
// and is deliberately not treated as a duplicate.

"use strict";

// APPS_KEY comes from ui/core.js — it owns the storage keys.

/**
 * Re-pressing Fill within this window is the SAME visit, not a second
 * application: without it, filling a form twice in a row would claim you had
 * applied twice.
 */
const DUPLICATE_QUIET_MS = 5 * 60 * 1000;

/** The log as last read: { items: [...] }, newest first. */
let applicationState = { items: [] };

/** Read (and coerce) the log. */
async function loadApplications() {
  try {
    const data = await chrome.storage.local.get(APPS_KEY);
    applicationState = JOB_AUTOFILL_SHARED.sanitizeApplications(data[APPS_KEY]);
  } catch (err) {
    applicationState = { items: [] };
  }
  return applicationState;
}

/** Persist the log. */
async function writeApplications() {
  try {
    await chrome.storage.local.set({ [APPS_KEY]: applicationState });
    return true;
  } catch (err) {
    return false;
  }
}

/** The row for a job we have applied to before, or null. */
function previousApplication(page) {
  if (!page) return null;
  const now = Date.now();
  return (
    applicationState.items.find(
      (entry) =>
        JOB_AUTOFILL_SHARED.sameApplication(entry, page) &&
        now - (entry.lastAt || 0) > DUPLICATE_QUIET_MS
    ) || null
  );
}

/**
 * Log this application. Returns { entry, isNew, repeated } or null when there is
 * nothing worth logging (no company, role or URL — a page that is not a posting).
 */
async function recordApplication(page) {
  if (!page) return null;
  const company = typeof page.company === "string" ? page.company.trim() : "";
  const role = typeof page.role === "string" ? page.role.trim() : "";
  const url = typeof page.url === "string" ? page.url.trim() : "";
  if (!company && !role && !url) return null;

  const now = Date.now();
  const existing = applicationState.items.find((entry) =>
    JOB_AUTOFILL_SHARED.sameApplication(entry, { company, role, url })
  );

  if (existing) {
    const repeated = now - (existing.lastAt || 0) <= DUPLICATE_QUIET_MS;
    if (!repeated) {
      existing.times = (existing.times || 1) + 1;
      existing.lastAt = now;
    }
    // Fill in anything the earlier record lacked.
    if (!existing.company) existing.company = company;
    if (!existing.role) existing.role = role;
    if (!existing.url) existing.url = url;
    await writeApplications();
    return { entry: existing, isNew: false, repeated };
  }

  const entry = {
    id: JOB_AUTOFILL_SHARED.newId(),
    company,
    role,
    url,
    host: typeof page.host === "string" ? page.host : "",
    at: now,
    lastAt: now,
    times: 1,
    status: "applied"
  };
  applicationState.items.unshift(entry);
  if (applicationState.items.length > JOB_AUTOFILL_SHARED.maxApplications) {
    applicationState.items.length = JOB_AUTOFILL_SHARED.maxApplications;
  }
  await writeApplications();
  return { entry, isNew: true, repeated: false };
}

/** Change one application's pipeline status. */
async function setApplicationStatus(id, status) {
  const entry = applicationState.items.find((item) => item.id === id);
  if (!entry) return false;
  if (JOB_AUTOFILL_SHARED.applicationStatuses.indexOf(status) === -1) return false;
  entry.status = status;
  return writeApplications();
}

/** Remove one row. */
async function deleteApplication(id) {
  const before = applicationState.items.length;
  applicationState.items = applicationState.items.filter((item) => item.id !== id);
  if (applicationState.items.length === before) return false;
  return writeApplications();
}

/** Remove every row. */
async function clearApplications() {
  applicationState = { items: [] };
  return writeApplications();
}

/** "Acme — Senior Frontend Engineer" (falls back to whatever we know). */
function describeApplication(entry) {
  const e = entry || {};
  const who = e.company || e.host || "Unknown company";
  return e.role ? `${who} — ${e.role}` : who;
}

/** A short local date for a stored timestamp. */
function formatWhen(at) {
  if (typeof at !== "number" || at <= 0) return "an unknown date";
  try {
    return new Date(at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch (err) {
    return "an unknown date";
  }
}

/** The log as CSV, for a spreadsheet (quoted, so commas are safe). */
function applicationsCsv() {
  const cell = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  const rows = [
    ["company", "role", "status", "applied", "last", "times", "url"].join(",")
  ];
  for (const entry of applicationState.items) {
    rows.push(
      [
        cell(entry.company),
        cell(entry.role),
        cell(entry.status),
        cell(entry.at ? new Date(entry.at).toISOString() : ""),
        cell(entry.lastAt ? new Date(entry.lastAt).toISOString() : ""),
        cell(entry.times || 1),
        cell(entry.url)
      ].join(",")
    );
  }
  return rows.join("\r\n");
}

// --- The options page's application list -----------------------------------

/** Render the log, newest first, with a status picker per row. */
function renderApplications() {
  const container = $("appRows");
  if (!container) return; // not the options page
  container.innerHTML = "";

  if (applicationState.items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "Nothing logged yet — press Fill on a job posting.";
    container.appendChild(empty);
    return;
  }

  for (const entry of applicationState.items) {
    const row = document.createElement("div");
    row.className = "app-row";

    const main = document.createElement("div");
    main.className = "app-main";

    const title = document.createElement("div");
    title.className = "app-title";
    title.textContent = describeApplication(entry);
    main.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "app-meta";
    const when = entry.lastAt || entry.at;
    meta.textContent = formatWhen(when) +
      (entry.times > 1 ? ` · filled ${entry.times}×` : "");
    if (entry.url) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.textContent = "open";
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(link);
    }
    main.appendChild(meta);

    const status = document.createElement("select");
    status.className = "app-status";
    status.title = "Where this application stands";
    for (const state of JOB_AUTOFILL_SHARED.applicationStatuses) {
      const option = document.createElement("option");
      option.value = state;
      option.textContent = state;
      status.appendChild(option);
    }
    status.value = entry.status;
    status.addEventListener("change", () => setApplicationStatus(entry.id, status.value));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "snip-del";
    remove.title = "Remove this application";
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await deleteApplication(entry.id);
      renderApplications();
    });

    row.appendChild(main);
    row.appendChild(status);
    row.appendChild(remove);
    container.appendChild(row);
  }
}

/** Download the log as a CSV file. */
function exportApplications() {
  try {
    const blob = new Blob([applicationsCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "job-applications.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Exported your application log.", "ok");
  } catch (err) {
    setStatus("Could not export the log.", "warn");
  }
}