// popup.js — UI controller for the Private Job Autofill extension.
// Loads/saves the profile to chrome.storage.local and injects the fill
// content script into the active tab AND all of its frames on demand
// (activeTab for the top frame + host_permissions for cross-origin ATS
// subframes such as Greenhouse/Lever/Workday).

"use strict";

const STORAGE_KEY = "jobProfile";

// The injected content scripts, in load order. They share the
// window.__JobAutofill namespace inside the page's isolated world, so the
// order matters: data → helpers → combobox driver → orchestrator.
const CONTENT_SCRIPTS = [
  "content/field-map.js",
  "content/dom-utils.js",
  "content/combobox.js",
  "content/fill.js",
  "content/dates.js",
  "content/repeatable.js",
  "content/radios.js",
  "content/files.js",
  "content/autofill.js"
];

// Every field id in popup.html that maps 1:1 to a key in the stored profile.
const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "linkedin",
  "github",
  "portfolio",
  "resume",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "currentCompany",
  "currentTitle",
  "school",
  "degree",
  "major",
  "graduationDate",
  "startDate",
  "yearsExperience",
  "noticePeriod",
  "desiredSalary",
  "preferredLocation",
  "workAuthorized",
  "sponsorship",
  "gender",
  "race",
  "veteran",
  "disability"
];

const $ = (id) => document.getElementById(id);

/**
 * Wire a handler only if the element exists. One missing control must never
 * abort the rest of the bootstrap — which also registers the result listener
 * that every fill depends on.
 */
function on(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfile();
  on("saveBtn", "click", saveProfile);
  on("fillBtn", "click", fillActiveTab);
  on("editProfileBtn", "click", openOptionsPage);
  on("exportBtn", "click", exportProfile);
  on("importBtn", "click", () => {
    const input = $("importFile");
    if (input) input.click();
  });
  on("importFile", "change", onImportFilePicked);
  on("deleteAllBtn", "click", deleteAllData);

  // Any edit in the form means what is on screen differs from what is stored.
  on("profileForm", "input", markDirty);
  on("profileForm", "change", markDirty);

  // The popup owns nothing but the "replace history" preference, so persist
  // that the moment it is toggled.
  on("replaceHistory", "change", () => {
    if (!autoSaveEnabled) autoSave();
  });

  // The full editor (options.html) saves as you type; the popup does not.
  autoSaveEnabled = !!(document.body && document.body.dataset.page === "options");
  if (autoSaveEnabled) {
    on("profileForm", "input", scheduleAutoSave);
    on("profileForm", "change", scheduleAutoSave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAutoSave();
    });
    window.addEventListener("pagehide", flushAutoSave);
  }

  on("addSnippetBtn", "click", () => addSnippetRow("", ""));
  on("addExpBtn", "click", () => addExperienceRow({}));
  on("addEduBtn", "click", () => addEducationRow({}));
  on("resumeFile", "change", onResumeFilePicked);
  on("clearResumeBtn", "click", clearResumeFile);

  // The injected autofill.js reports its result back through runtime messaging.
  chrome.runtime.onMessage.addListener(onAutofillResult);
});

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
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (err) {
    setStatus("Could not clear local storage.", "warn");
    return;
  }
  fillFormFromProfile({});
  setStatus("All local data deleted from this browser.", "ok");
}

// Completion model -----------------------------------------------------------
// A frame is a KNOWN quantity: chrome.scripting.executeScript resolves with one
// InjectionResult per frame it injected into, so we wait for EVERY expected
// frame to report instead of guessing completion from a quiet gap. A frame
// that spends seconds working (waitForFields, dropdown waits) can therefore no
// longer have its result silently dropped. A hard deadline covers frames that
// never report, and that shortfall is reported to the user rather than hidden.
const RUN_DEADLINE_MS = 15000; // absolute cap for a whole run
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
      frames: 0, contributingFrames: 0,
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

    if (notes.length > 0) {
      const status = $("status");
      if (status) status.textContent += " " + notes.join(" ");
    }
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

/** List the fields we could not fill, so the user knows what is left. */
/** Ask the page to scroll to and flash one of the fields left for you. */
function locateField(ref, li) {
  if (!ref) return;
  if (li) {
    li.classList.add("locating");
    setTimeout(() => li.classList.remove("locating"), 900);
  }
  if (typeof activeTabId !== "number") return;
  try {
    chrome.tabs.sendMessage(activeTabId, { type: "JOB_AUTOFILL_LOCATE", ref });
  } catch (err) {
    /* the frame may be gone, or access is no longer granted */
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
