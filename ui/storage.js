// storage.js — the profile data layer: load/save chrome.storage.local, the
// repeatable section cards, resume handling, and export / import / delete-all.

"use strict";

/** Populate the form from chrome.storage.local when the popup opens. */
async function loadProfile() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const profile = data[STORAGE_KEY] || {};
    storedProfile = profile;

    // A page shows only the sections it owns, so skip missing ones instead of
    // throwing and reporting a bogus "could not read storage" error.
    for (const field of PROFILE_FIELDS) {
      const el = $(field);
      if (el && typeof profile[field] === "string") el.value = profile[field];
    }
    if ($("snippetRows")) renderSnippets(profile.customSnippets);
    if ($("expRows")) renderExperiences(profile.workExperiences);
    if ($("eduRows")) renderEducations(profile.educations);
    storedResume =
      profile.resumeFile && typeof profile.resumeFile === "object"
        ? profile.resumeFile
        : null;
    pendingResume = null;
    renderResumeInfo();
    const replaceBox = $("replaceHistory");
    if (replaceBox) replaceBox.checked = profile.replaceHistory === true;
    renderProfileSummary(profile);
  } catch (err) {
    setStatus("⚠️ Could not read local storage.", "warn");
  }
}

// The last profile read from storage. A page that shows only PART of the
// editor (the compact popup) starts from this and overwrites only the sections
// it actually displays, so saving from one page can never wipe a section that
// lives on the other.
let storedProfile = {};

/**
 * The profile THIS page can see, merged over what is already stored.
 * Sections absent from this page are deliberately left untouched.
 */
function readForm() {
  const profile = Object.assign({}, storedProfile);

  for (const field of PROFILE_FIELDS) {
    const el = $(field);
    if (el) profile[field] = (el.value || "").trim();
  }
  if ($("snippetRows")) profile.customSnippets = collectSnippets();
  if ($("expRows")) profile.workExperiences = collectExperiences();
  if ($("eduRows")) profile.educations = collectEducations();
  if ($("replaceHistory")) {
    profile.replaceHistory = $("replaceHistory").checked;
  }
  profile.resumeFile = pendingResume || storedResume || null;
  return profile;
}

// --- Unsaved-change tracking ----------------------------------------------
// Filling reads the SAVED profile, so edits made in this popup are invisible to
// it until Save. Track that explicitly instead of letting it happen silently.

let formDirty = false;

function markDirty() {
  if (formDirty) return;
  formDirty = true;
  const badge = $("dirtyBadge");
  if (badge) badge.hidden = false;
}

function markClean() {
  formDirty = false;
  const badge = $("dirtyBadge");
  if (badge) badge.hidden = true;
}

/**
 * Write a profile to storage and refresh everything that reflects it.
 * Single write path, shared by the explicit Save, the auto-save and the flag.
 */
async function persist(profile) {
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  storedProfile = profile;
  storedResume = profile.resumeFile;
  pendingResume = null;
  renderResumeInfo();
  renderProfileSummary(profile);
  markClean();
}

/** Quiet save used by the options page's auto-save. */
async function autoSave() {
  try {
    await persist(readForm());
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus("Could not save to local storage.", "warn");
  }
}

// The options page is a dedicated editor, so it saves as you type; the popup
// only fills and persists the one preference it owns.
const AUTOSAVE_MS = 400;
let autoSaveTimer = null;
let autoSaveEnabled = false;

function scheduleAutoSave() {
  if (!autoSaveEnabled) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    autoSave();
  }, AUTOSAVE_MS);
}

/** Write pending edits immediately (a tab being hidden must not lose them). */
function flushAutoSave() {
  if (!autoSaveEnabled || !autoSaveTimer) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  autoSave();
}

/** Persist the current form values to chrome.storage.local. */
async function saveProfile() {
  const profile = readForm();

  try {
    await persist(profile);
    setStatus("✅ Profile saved locally.", "ok");
  } catch (err) {
    setStatus("⚠️ Could not save to local storage.", "warn");
  }
}

// --- Resume file (feature 3, auto-attach) --------------------------------

let storedResume = null;   // { name, type, size, dataUrl } already persisted
let pendingResume = null;  // { ... } picked this session, awaiting Save

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
  reader.onload = () => {
    pendingResume = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: String(reader.result)
    };
    renderResumeInfo();
    markDirty(); // a freshly picked resume is not stored until Save
  };
  reader.onerror = () => setStatus("⚠️ Could not read that file.", "warn");
  reader.readAsDataURL(file);
}

/** Forget the stored resume. */
function clearResumeFile() {
  pendingResume = null;
  storedResume = null;
  const input = $("resumeFile");
  if (input) input.value = "";
  renderResumeInfo();
  markDirty();
}

// --- Custom snippets (feature 4) -----------------------------------------

/** Render the saved custom-snippet rows into the popup. */
function renderSnippets(snippets) {
  const container = $("snippetRows");
  container.innerHTML = "";
  const list = Array.isArray(snippets) ? snippets : [];
  if (list.length === 0) return;
  for (const snippet of list) {
    addSnippetRow((snippet && snippet.key) || "", (snippet && snippet.value) || "");
  }
}

/** Add one editable Key/Value row (built with the DOM API, never innerHTML). */
function addSnippetRow(key, value) {
  const container = $("snippetRows");

  const row = document.createElement("div");
  row.className = "snip-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "snip-key";
  keyInput.placeholder = "salary";
  keyInput.value = key;

  const valueInput = document.createElement("textarea");
  valueInput.className = "snip-value";
  valueInput.rows = 2;
  valueInput.placeholder = "Short answer, or paste a long paragraph…";
  valueInput.value = value;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "snip-del";
  remove.title = "Remove snippet";
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(remove);
  container.appendChild(row);
}

/** Read the snippet rows back into a [{key, value}] array (blanks dropped). */
function collectSnippets() {
  const out = [];
  document.querySelectorAll("#snippetRows .snip-row").forEach((row) => {
    const key = (row.querySelector(".snip-key").value || "").trim();
    const value = (row.querySelector(".snip-value").value || "").trim();
    if (key && value) out.push({ key, value });
  });
  return out;
}

// --- Work Experience (repeatable section) --------------------------------

/** Render saved work-experience entries into the popup. */
function renderExperiences(list) {
  const container = $("expRows");
  container.innerHTML = "";
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) addExperienceRow(entry || {});
}

// --- Repeatable card helpers ---------------------------------------------

/** Create a card (header + grid) inside `container`; returns the grid. */
function buildCard(container, title) {
  const card = document.createElement("div");
  card.className = "exp-card";

  const head = document.createElement("div");
  head.className = "exp-head";
  const caption = document.createElement("span");
  caption.className = "exp-caption";
  caption.textContent = title;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "snip-del";
  remove.title = "Remove";
  remove.textContent = "×";
  remove.addEventListener("click", () => card.remove());
  head.appendChild(caption);
  head.appendChild(remove);

  const grid = document.createElement("div");
  grid.className = "exp-grid";

  card.appendChild(head);
  card.appendChild(grid);
  container.appendChild(card);
  return grid;
}

/** One labelled text input inside a card grid. */
function addCardField(grid, labelText, cls, value, full) {
  const wrap = document.createElement("div");
  wrap.className = "field" + (full ? " full" : "");
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.className = cls;
  input.value = value || "";
  wrap.appendChild(label);
  wrap.appendChild(input);
  grid.appendChild(wrap);
  return input;
}

/** One labelled textarea inside a card grid. */
function addCardTextarea(grid, labelText, cls, value, rows) {
  const wrap = document.createElement("div");
  wrap.className = "field full";
  const label = document.createElement("label");
  label.textContent = labelText;
  const area = document.createElement("textarea");
  area.className = cls;
  area.rows = rows || 3;
  area.value = value || "";
  wrap.appendChild(label);
  wrap.appendChild(area);
  grid.appendChild(wrap);
  return area;
}

/** Add one work-experience card (built with the DOM API, never innerHTML). */
function addExperienceRow(entry) {
  entry = entry || {};
  const grid = buildCard($("expRows"), "Experience");

  addCardField(grid, "Job Title", "exp-title", entry.title);
  addCardField(grid, "Company", "exp-company", entry.company);
  addCardField(grid, "Location", "exp-location", entry.location, true);
  addCardField(grid, "From (MM/YYYY)", "exp-from", entry.from);
  addCardField(grid, "To (MM/YYYY)", "exp-to", entry.to);
  addCardTextarea(grid, "Role Description", "exp-desc", entry.description, 3);

  const currentWrap = document.createElement("label");
  currentWrap.className = "exp-current";
  const current = document.createElement("input");
  current.type = "checkbox";
  current.className = "exp-current-box";
  current.checked = !!entry.current;
  currentWrap.appendChild(current);
  currentWrap.appendChild(document.createTextNode(" I currently work here"));
  grid.appendChild(currentWrap);
}

// --- Education (repeatable section) --------------------------------------

/** Render saved education entries into the popup. */
function renderEducations(list) {
  const container = $("eduRows");
  container.innerHTML = "";
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) addEducationRow(entry || {});
}

/** Add one education card. */
function addEducationRow(entry) {
  entry = entry || {};
  const grid = buildCard($("eduRows"), "Education");

  addCardField(grid, "School or University", "edu-school", entry.school, true);
  addCardField(grid, "Degree", "edu-degree", entry.degree, true);
  addCardField(grid, "Field of Study", "edu-major", entry.major, true);
  addCardField(grid, "Overall Result (GPA)", "edu-gpa", entry.gpa);
  addCardField(grid, "From (YYYY)", "edu-from", entry.from);
  addCardField(grid, "To (YYYY)", "edu-to", entry.to);
}

/** Read the cards back into an array of entries (blank cards dropped). */
function collectExperiences() {
  const out = [];
  document.querySelectorAll("#expRows .exp-card").forEach((card) => {
    const read = (cls) => (card.querySelector(cls).value || "").trim();
    const entry = {
      title: read(".exp-title"),
      company: read(".exp-company"),
      location: read(".exp-location"),
      from: read(".exp-from"),
      to: read(".exp-to"),
      description: read(".exp-desc"),
      current: !!card.querySelector(".exp-current-box").checked
    };
    if (entry.title || entry.company) out.push(entry);
  });
  return out;
}

/** Read the education cards back into an array of entries. */
function collectEducations() {
  const out = [];
  document.querySelectorAll("#eduRows .exp-card").forEach((card) => {
    const read = (cls) => (card.querySelector(cls).value || "").trim();
    const entry = {
      school: read(".edu-school"),
      degree: read(".edu-degree"),
      major: read(".edu-major"),
      gpa: read(".edu-gpa"),
      from: read(".edu-from"),
      to: read(".edu-to")
    };
    if (entry.school || entry.degree) out.push(entry);
  });
  return out;
}

/**
 * Aggregate results from EVERY frame the script runs in. With allFrames the
 * script executes in the top frame and in each embedded ATS iframe, and each
 * one reports independently — so we sum their "filled" counts instead of
 * letting the last message overwrite the status line.
 */
/** One-line "what's saved" summary, used by the compact popup. */
function renderProfileSummary(profile) {
  const el = $("profileSummary");
  if (!el) return;
  const source = profile || {};
  const name = [source.firstName, source.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();
  const jobs = Array.isArray(source.workExperiences)
    ? source.workExperiences.length
    : 0;
  const edus = Array.isArray(source.educations) ? source.educations.length : 0;
  const resume = source.resumeFile && source.resumeFile.name;

  if (!name && !source.email && !jobs && !edus && !resume) {
    el.textContent = "No profile saved yet — open the full editor to set one up.";
    el.className = "summary empty";
    return;
  }

  const bits = [];
  if (name) bits.push(name);
  if (source.email) bits.push(source.email);
  bits.push(resume ? "resume: " + resume : "no resume yet");
  if (jobs) bits.push(jobs + (jobs === 1 ? " job" : " jobs"));
  if (edus) bits.push(edus + (edus === 1 ? " degree" : " degrees"));
  el.textContent = bits.join(" · ");
  el.className = "summary";
}

/** Open the full-page profile editor (options.html). */
function openOptionsPage() {
  try {
    if (chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
      chrome.runtime.openOptionsPage();
    }
  } catch (err) {
    /* nothing else we can do from here */
  }
}

// --- Export / import / delete-all -----------------------------------------
// The data is local-only, so the user needs a backup path and a wipe button.

const EXPORT_FORMAT = "job-autofill-profile";
const EXPORT_VERSION = 1;

/** Keep only the keys we understand, with the types we expect. */
function sanitizeProfile(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = {};

  for (const field of PROFILE_FIELDS) {
    if (typeof source[field] === "string") out[field] = source[field];
  }
  if (typeof source.replaceHistory === "boolean") {
    out.replaceHistory = source.replaceHistory;
  }

  const pick = (value, keys) => {
    const entry = {};
    for (const key of keys) {
      if (value && typeof value[key] === "string") entry[key] = value[key];
    }
    return entry;
  };

  if (Array.isArray(source.customSnippets)) {
    out.customSnippets = source.customSnippets
      .map((s) => pick(s, ["key", "value"]))
      .filter((s) => s.key && s.value);
  }
  if (Array.isArray(source.workExperiences)) {
    out.workExperiences = source.workExperiences
      .map((e) => {
        const entry = pick(e, [
          "title",
          "company",
          "location",
          "from",
          "to",
          "description"
        ]);
        if (e && typeof e.current === "boolean") entry.current = e.current;
        return entry;
      })
      .filter((e) => e.title || e.company);
  }
  if (Array.isArray(source.educations)) {
    out.educations = source.educations
      .map((e) => pick(e, ["school", "degree", "major", "gpa", "from", "to"]))
      .filter((e) => e.school || e.degree);
  }

  const file = source.resumeFile;
  if (file && typeof file === "object" && typeof file.dataUrl === "string") {
    out.resumeFile = {
      name: typeof file.name === "string" ? file.name : "resume.pdf",
      type: typeof file.type === "string" ? file.type : "application/pdf",
      size: typeof file.size === "number" ? file.size : 0,
      dataUrl: file.dataUrl
    };
  }
  return out;
}

/** The export file's text (pure, so it can be tested without a download). */
function buildExportText(profile) {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: sanitizeProfile(profile)
    },
    null,
    2
  );
}

/** Parse imported text into a profile, or throw a friendly Error. */
function parseImportText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error("That file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("That file does not contain a profile.");
  }
  const raw = data.profile && typeof data.profile === "object" ? data.profile : data;
  const profile = sanitizeProfile(raw);
  if (Object.keys(profile).length === 0) {
    throw new Error("That file does not contain a profile.");
  }
  return profile;
}

/** Push a profile object into the form (no storage write). */
function fillFormFromProfile(profile) {
  const source = profile || {};
  for (const field of PROFILE_FIELDS) {
    $(field).value = typeof source[field] === "string" ? source[field] : "";
  }
  const replaceBox = $("replaceHistory");
  if (replaceBox) replaceBox.checked = source.replaceHistory === true;
  renderSnippets(source.customSnippets);
  renderExperiences(source.workExperiences);
  renderEducations(source.educations);
  storedResume =
    source.resumeFile && typeof source.resumeFile === "object"
      ? source.resumeFile
      : null;
  pendingResume = null;
  renderResumeInfo();
  markClean();
}

/** Write a profile to storage AND show it. */
async function applyProfile(profile) {
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  fillFormFromProfile(profile);
}

/** Download the form's current contents as a JSON file. */
function exportProfile() {
  try {
    const blob = new Blob([buildExportText(readForm())], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "job-autofill-profile.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Exported. That file holds your personal details — keep it safe.", "ok");
  } catch (err) {
    setStatus("Could not build the export file.", "warn");
  }
}

/** Import a previously exported JSON file (replacing what is stored). */
async function onImportFilePicked() {
  const input = $("importFile");
  const file = input && input.files && input.files[0];
  if (!file) return;
  try {
    const profile = parseImportText(await file.text());
    const proceed =
      typeof window.confirm !== "function" ||
      window.confirm("Replace everything in this browser with the imported profile?");
    if (!proceed) {
      setStatus("Import cancelled — nothing changed.", "warn");
      return;
    }
    await applyProfile(profile);
    setStatus("Imported. Check the fields above, then fill.", "ok");
  } catch (err) {
    setStatus((err && err.message) || "Could not import that file.", "warn");
  } finally {
    if (input) input.value = "";
  }
}

/** Wipe everything this extension stored, after an explicit confirmation. */
async function deleteAllData() {
  const proceed =
    typeof window.confirm !== "function" ||
    window.confirm(
      "Delete everything?\n\n" +
        "Your profile, resume file, work history and saved answers will be " +
        "removed from this browser. This cannot be undone."
    );
  if (!proceed) {
    setStatus("Delete cancelled — nothing changed.", "warn");
    return;
  }
  try {
    // Both keys go: the profile AND anything learned from typing.
    await chrome.storage.local.remove([STORAGE_KEY, LEARNED_KEY]);
  } catch (err) {
    setStatus("Could not clear local storage.", "warn");
    return;
  }
  fillFormFromProfile({});
  setStatus("All local data deleted from this browser.", "ok");
}
