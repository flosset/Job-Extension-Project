// resume.js — the resume file the fill auto-attaches (feature 3): read the
// picked file into a data URL so it can be stored locally, show which one is
// stored, and forget it. Loaded into the same page scope as profile-form.js.

// --- Resume file (feature 3, auto-attach) --------------------------------

let storedResume = null;   // { name, type, size, dataUrl } already persisted
let pendingResume = null;  // { ... } picked this session, awaiting Save
let resumeReadToken = 0;

/** Human-readable file size. */
function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/** Show which resume (if any) will be auto-attached. */
function renderResumeInfo() {
  const el = $("resumeFileInfo");
  if (!el) return;
  const record = pendingResume || storedResume;
  el.textContent = record
    ? `Stored locally: ${record.name} (${formatSize(record.size)})`
    : "No resume stored.";
}

/** Read the picked file into a data URL so it can be stored locally. */
function onResumeFilePicked() {
  const input = $("resumeFile");
  const file = input.files && input.files[0];
  if (!file) {
    pendingResume = null;
    renderResumeInfo();
    return;
  }
  const reader = new FileReader();
  const epoch = editEpoch;
  const token = ++resumeReadToken;
  reader.onload = () => {
    if (epoch !== editEpoch || token !== resumeReadToken || deletingData) return;
    pendingResume = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: String(reader.result)
    };
    renderResumeInfo();
    profileChanged();
  };
  reader.onerror = () => setStatus("⚠️ Could not read that file.", "warn");
  reader.readAsDataURL(file);
}

/** Forget the stored resume. */
function clearResumeFile() {
  resumeReadToken++;
  pendingResume = null;
  storedResume = null;
  const input = $("resumeFile");
  if (input) input.value = "";
  renderResumeInfo();
  profileChanged();
}
