// job-ask.js — the "which job is this?" question: when a page cannot name the
// job, the popup asks rather than filing a nameless row. The answer is written
// into the one row the fill already created.

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