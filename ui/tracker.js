// tracker.js — the application log: company / role / URL / date, so a repeat
// application can be caught BEFORE the form is filled again.
//
// Identity is "same company AND same role" (legal-form insensitive), or the same
// posting URL. A different role at the same company is a different application
// and is deliberately not treated as a duplicate.

"use strict";

// APPS_KEY comes from ui/core.js — it owns the storage keys.

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

/**
 * A job we have applied to before, or null: { entry, level }. The rule lives in
 * shared.js so the popup and the keyboard shortcut agree.
 */
function previousApplication(page) {
  return JOB_AUTOFILL_SHARED.findPreviousApplication(page, applicationState.items);
}

/**
 * Log this application. The merge/create rule lives in shared.js so the popup
 * and the keyboard shortcut cannot drift; here we only keep the in-memory copy
 * the list renders in sync.
 */
async function recordApplication(page) {
  const result = await JOB_AUTOFILL_SHARED.logApplication(page);
  if (!result) return null;
  await loadApplications();
  return result;
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

/** Change one application's name/role (the page often cannot tell us). */
async function setApplicationName(id, company, role) {
  const entry = applicationState.items.find((item) => item.id === id);
  if (!entry) return false;
  const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  entry.company = clean(company).slice(0, 80);
  entry.role = clean(role).slice(0, 120);
  return writeApplications();
}

// --- "Which job is this?" ---------------------------------------------------
// When the page cannot name the job we ASK, rather than filing a nameless row.
// It is a question, so it is never answered for the user: whatever the page did
// manage to read is prefilled, and the answer goes into the one row this fill
// already created.

/** The question currently on screen: { id, company, role, dismissed }. */
let jobAsk = null;

/** Show the question, prefilled with whatever the page did give us. */
function showJobAsk(ask) {
  const box = $("askJob");
  if (!box) return; // not the popup
  jobAsk = ask || {};
  const company = $("askCompany");
  const role = $("askRole");
  if (company) company.value = jobAsk.company || "";
  if (role) role.value = jobAsk.role || "";
  // Say exactly what is missing, so a half-known job does not look like a bug.
  const note = $("askNote");
  if (note) {
    const missing = [];
    if (!jobAsk.company) missing.push("company");
    if (!jobAsk.role) missing.push("role");
    note.textContent = missing.length === 1
      ? `This page didn't give us the ${missing[0]}. Add it and it goes into your application log.`
      : "This page didn't give us the company and the role. Add them and they go into your application log.";
  }
  box.hidden = false;
}

/** Hide the question (and forget it for this run — see fill-runner). */
function hideJobAsk() {
  const box = $("askJob");
  if (box) box.hidden = true;
  jobAsk = null;
}

/** Save the answer into the row this fill created. */
async function saveJobAsk() {
  if (!jobAsk || !jobAsk.id) {
    hideJobAsk();
    return;
  }
  const company = $("askCompany");
  const role = $("askRole");
  await setApplicationName(
    jobAsk.id,
    company ? company.value : "",
    role ? role.value : ""
  );
  // Do not ask again for this run: the row is named now.
  if (typeof markAskAnswered === "function") await markAskAnswered();
  hideJobAsk();
  setStatus("📋 Saved to your applications.", "ok");
}

/** "Not now": stop asking for this run, without writing anything. */
async function dismissJobAsk() {
  if (typeof markAskAnswered === "function") await markAskAnswered();
  hideJobAsk();
  setStatus("Left out of the log for now — you can name it on the options page.", "");
}

/** Render the log, newest first, with an editable name per row. */
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
    // Hovering a row shows the full "Company — Role", whatever the inputs hold.
    row.title = describeApplication(entry);

    const main = document.createElement("div");
    main.className = "app-main";

    // The name, editable in place: whichever parts the page could tell us are
    // filled in, and the rest is one click away from being right.
    const name = document.createElement("div");
    name.className = "app-name";
    const company = document.createElement("input");
    company.type = "text";
    company.className = "app-company";
    company.placeholder = "Company";
    company.value = entry.company || "";
    company.title = "Company — edit if the page did not say";
    const role = document.createElement("input");
    role.type = "text";
    role.className = "app-role";
    role.placeholder = "Role";
    role.value = entry.role || "";
    role.title = "Role — edit if the page did not say";
    const save = () => setApplicationName(entry.id, company.value, role.value);
    company.addEventListener("change", save);
    role.addEventListener("change", save);
    name.appendChild(company);
    name.appendChild(role);
    main.appendChild(name);

    // When applied, and where it was — the two facts the list exists for.
    const meta = document.createElement("div");
    meta.className = "app-meta";
    const when = entry.lastAt || entry.at;
    meta.textContent =
      formatWhen(when) +
      (entry.times > 1 ? ` · filled ${entry.times}×` : "") +
      (entry.host ? ` · ${entry.host}` : "");
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

    // One click to say "I submitted this". Only the user can know, so it is a
    // button rather than something we infer, and it disappears once the status
    // is already past that point.
    if (JOB_AUTOFILL_SHARED.appliedStatuses.indexOf(entry.status) === -1) {
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = "app-mark";
      mark.textContent = "Mark applied";
      mark.title = "You submitted this application — move it out of \"in progress\"";
      mark.addEventListener("click", async () => {
        await setApplicationStatus(entry.id, "applied");
        renderApplications();
      });
      row.appendChild(mark);
    }

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