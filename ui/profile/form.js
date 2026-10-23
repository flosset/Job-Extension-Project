// profile-form.js — the profile form: load it from chrome.storage.local, read
// it back, track unsaved edits, auto-save on the options page, and render the
// compact "what's saved" summary.
//
// The repeatable section cards live in profile-sections.js, the resume in
// resume.js, and backup / restore / wipe in backup.js. All four are loaded by
// the same pages into one shared scope, so they call each other directly.

"use strict";

/** Populate the form from chrome.storage.local when the popup opens. */
async function loadProfile() {
  const epoch = editEpoch;
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (epoch !== editEpoch || deletingData) return;
    const profile = data[STORAGE_KEY] || {};
    storedProfile = profile;

    // A page shows only the sections it owns, so skip missing ones instead of
    // throwing and reporting a bogus "could not read storage" error.
    for (const field of PROFILE_FIELDS) {
      const el = $(field);
      if (el) el.value = typeof profile[field] === "string" ? profile[field] : "";
    }
    if ($("snippetRows")) renderSnippets(profile.customSnippets);
    if ($("templateRows")) renderTemplates(profile.coverLetterTemplates);
    if ($("expRows")) renderExperiences(profile.workExperiences);
    if ($("eduRows")) renderEducations(profile.educations);
    storedResume =
      profile.resumeFile && typeof profile.resumeFile === "object"
        ? profile.resumeFile
        : null;
    pendingResume = null;
    resumeReadToken++;
    renderResumeInfo();
    const replaceBox = $("replaceHistory");
    if (replaceBox) replaceBox.checked = profile.replaceHistory === true;
    renderProfileSummary(profile);
    markClean();
    formBaseline = readForm();
  } catch (err) {
    setStatus("⚠️ Could not read local storage.", "warn");
  }
}

// The last profile read from storage. A page that shows only PART of the
// editor (the compact popup) starts from this and overwrites only the sections
// it actually displays, so saving from one page can never wipe a section that
// lives on the other.
let storedProfile = {};
let formBaseline = {};

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
  if ($("templateRows")) profile.coverLetterTemplates = collectTemplates();
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
let editEpoch = 0;
let deletingData = false;
let profileWrites = Promise.resolve();
let editRevision = 0;

/** Every user mutation, including buttons and completed file reads. */
function profileChanged() {
  if (deletingData) return;
  editRevision++;
  markDirty();
  scheduleAutoSave();
}

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
  const epoch = editEpoch;
  const revision = editRevision;
  const profileId = profileState.activeId;
  const task = profileWrites.catch(() => {}).then(() => JOB_AUTOFILL_SHARED.withStorageLock(async () => {
    if (deletingData || epoch !== editEpoch) return null;
    const data = await chrome.storage.local.get([STORAGE_KEY, PROFILES_KEY]);
    if (deletingData || epoch !== editEpoch) return null;
    const state = JOB_AUTOFILL_SHARED.sanitizeProfiles(data[PROFILES_KEY], data[STORAGE_KEY] || {});
    if (profileId && state.activeId !== profileId) throw new Error("The active profile changed. Reopen the editor before saving.");
    const latest = data[STORAGE_KEY] || {};
    const changes = Object.fromEntries(Object.entries(profile).filter(([key, value]) =>
      !Object.prototype.hasOwnProperty.call(latest, key) || JSON.stringify(value) !== JSON.stringify(formBaseline[key])
    ));
    const saved = Object.assign({}, latest, changes);
    const active = state.items.find(item => item.id === state.activeId);
    active.profile = saved;
    await chrome.storage.local.set({ [STORAGE_KEY]: saved, [PROFILES_KEY]: state });
    if (deletingData || epoch !== editEpoch) return null;
    profileState = state;
    return saved;
  }));
  profileWrites = task;
  const saved = await task;
  if (!saved) return;
  formBaseline = profile;
  if (revision !== editRevision) return;
  storedProfile = saved;
  for (const field of PROFILE_FIELDS) {
    const el = $(field);
    const value = typeof saved[field] === "string" ? saved[field] : "";
    if (el && el.value !== value) el.value = value;
  }
  // Keep unchanged editor nodes alive so autosave never steals keyboard focus.
  for (const [id, key, collect, render] of [
    ["snippetRows", "customSnippets", collectSnippets, renderSnippets],
    ["templateRows", "coverLetterTemplates", collectTemplates, renderTemplates],
    ["expRows", "workExperiences", collectExperiences, renderExperiences],
    ["eduRows", "educations", collectEducations, renderEducations]
  ]) {
    if ($(id) && JSON.stringify(collect()) !== JSON.stringify(saved[key] || [])) render(saved[key]);
  }
  if ($("replaceHistory")) $("replaceHistory").checked = saved.replaceHistory === true;
  storedResume = saved.resumeFile;
  pendingResume = null;
  renderResumeInfo();
  renderProfileSummary(saved);
  renderRecipes();
  renderWidgetOffer();
  markClean();
  formBaseline = readForm();
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
  if (!autoSaveEnabled || deletingData) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    autoSave();
  }, AUTOSAVE_MS);
}

/** Write pending edits immediately (a tab being hidden must not lose them). */
async function flushAutoSave() {
  if (deletingData) return;
  const pending = autoSaveEnabled && formDirty;
  cancelAutoSave();
  if (pending) await persist(readForm());
  await profileWrites;
}

/**
 * Throw away a pending auto-save. Switching profiles does this first: the
 * pending write belongs to the profile being left, and firing it afterwards
 * would overwrite the profile just switched to.
 */
function cancelAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
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

/** Push a profile object into the form (no storage write). */
function fillFormFromProfile(profile) {
  const source = profile || {};
  storedProfile = source;
  if (typeof renderRecipes === "function") renderRecipes();
  if (typeof renderWidgetOffer === "function") renderWidgetOffer();
  resumeReadToken++;
  for (const field of PROFILE_FIELDS) {
    const el = $(field);
    if (el) el.value = typeof source[field] === "string" ? source[field] : "";
  }
  const replaceBox = $("replaceHistory");
  if (replaceBox) replaceBox.checked = source.replaceHistory === true;
  if ($("snippetRows")) renderSnippets(source.customSnippets);
  if ($("templateRows")) renderTemplates(source.coverLetterTemplates);
  if ($("expRows")) renderExperiences(source.workExperiences);
  if ($("eduRows")) renderEducations(source.educations);
  storedResume =
    source.resumeFile && typeof source.resumeFile === "object"
      ? source.resumeFile
      : null;
  pendingResume = null;
  renderResumeInfo();
  renderProfileSummary(source);
  markClean();
  formBaseline = readForm();
}
