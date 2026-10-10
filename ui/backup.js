// backup.js — data ownership: back up everything to one JSON file, restore it,
// and wipe it all. The profile, the named profiles, the widgets, the application
// log and the learned answers travel together; Delete all removes every key the
// extension writes. Loaded into the same page scope as profile-form.js.

// --- Export / import / delete-all -----------------------------------------
// The data is local-only, so the user needs a backup path and a wipe button.

const EXPORT_FORMAT = "job-autofill-profile";
const EXPORT_VERSION = 3;

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
  if (Array.isArray(source.coverLetterTemplates)) {
    out.coverLetterTemplates = source.coverLetterTemplates
      .map((t) => pick(t, ["name", "body"]))
      .filter((t) => t.body);
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

/**
 * The backup file's text (pure, so it can be tested without a download). It is a
 * FULL backup: the profile you are editing, the saved widgets, the NAMED
 * profiles (each with its own resume), the application log and the answers
 * learned from typing — so moving to a new machine keeps the time you have
 * invested. Everything in it is personal, so the same "keep it safe" advice
 * applies to the whole file.
 */
function buildExportText(profile, widgets, rest) {
  const out = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: sanitizeProfile(profile)
  };
  const items = JOB_AUTOFILL_SHARED.sanitizeRecipes(
    widgets && typeof widgets === "object" ? widgets : { items: [] }
  ).items;
  if (items.length) out.widgets = items;

  if (rest && typeof rest === "object") {
    const profiles = JOB_AUTOFILL_SHARED.sanitizeProfiles(rest.profiles, null);
    out.profiles = profiles;
    const applications = JOB_AUTOFILL_SHARED.sanitizeApplications(rest.applications);
    out.applications = applications;
    const learned = JOB_AUTOFILL_SHARED.sanitizeLearned(rest.learned);
    out.learned = learned;
    out.widgets = items;
    out.fullBackup = true;
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Parse an imported file into everything it carries — the profile plus widgets,
 * named profiles, the application log and the learned answers — or throw a
 * friendly Error. An older or hand-written file simply carries fewer of these.
 */
function parseImportRecords(text) {
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
  return {
    sections: {
      widgets: Object.prototype.hasOwnProperty.call(data, "widgets"),
      profiles: Object.prototype.hasOwnProperty.call(data, "profiles"),
      applications: Object.prototype.hasOwnProperty.call(data, "applications"),
      learned: Object.prototype.hasOwnProperty.call(data, "learned")
    },
    profile,
    widgets: JOB_AUTOFILL_SHARED.sanitizeRecipes(
      data.widgets && typeof data.widgets === "object" ? data.widgets : { items: [] }
    ).items,
    profiles: JOB_AUTOFILL_SHARED.sanitizeProfiles(data.profiles, null),
    applications: JOB_AUTOFILL_SHARED.sanitizeApplications(data.applications),
    learned: JOB_AUTOFILL_SHARED.sanitizeLearned(data.learned)
  };
}

/** Parse imported text into a profile, or throw a friendly Error. */
function parseImportText(text) {
  return parseImportRecords(text).profile;
}


/** Download a full backup: profile, widgets, named profiles, log, answers. */
async function exportProfile() {
  let widgets = { items: [] };
  let rest = null;
  try {
    const data = await chrome.storage.local.get([
      RECIPES_KEY,
      PROFILES_KEY,
      APPS_KEY,
      LEARNED_KEY
    ]);
    widgets = JOB_AUTOFILL_SHARED.sanitizeRecipes(data && data[RECIPES_KEY]);
    rest = {
      profiles: (data && data[PROFILES_KEY]) || null,
      applications: (data && data[APPS_KEY]) || null,
      learned: (data && data[LEARNED_KEY]) || null
    };
  } catch (err) {
    setStatus("Could not read all data — no incomplete backup was downloaded.", "warn");
    return;
  }
  try {
    const blob = new Blob([buildExportText(readForm(), widgets, rest)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "job-autofill-backup.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(
      "Backed up everything — that file holds your personal details, keep it safe.",
      "ok"
    );
  } catch (err) {
    setStatus("Could not build the backup file.", "warn");
  }
}

/** Restore a previously exported JSON file (replacing what is stored). */
async function onImportFilePicked() {
  const input = $("importFile");
  const file = input && input.files && input.files[0];
  if (!file) return;
  try {
    const records = parseImportRecords(await file.text());
    const proceed =
      typeof window.confirm !== "function" ||
      window.confirm(
        "Restore everything from this file? It replaces your profile, widgets, " +
          "named profiles, application log and saved answers in this browser."
      );
    if (!proceed) {
      setStatus("Restore cancelled — nothing changed.", "warn");
      return;
    }
    cancelAutoSave();
    await profileWrites.catch(() => {});
    const values = { [STORAGE_KEY]: records.profile };
    // Each section is restored only when the file carries it, so an older or
    // partial file never wipes the parts it does not mention.
    if (records.sections.widgets) {
      values[RECIPES_KEY] = { items: records.widgets };
    }
    if (records.sections.profiles) {
      values[PROFILES_KEY] = records.profiles;
      const active = records.profiles.items.find((item) => item.id === records.profiles.activeId);
      if (active) active.profile = records.profile;
    } else if (typeof activeProfile === "function" && activeProfile()) {
      activeProfile().profile = records.profile;
      values[PROFILES_KEY] = profileState;
    }
    if (records.sections.applications) {
      values[APPS_KEY] = records.applications;
    }
    if (records.sections.learned) {
      values[LEARNED_KEY] = records.learned;
    }
    await chrome.storage.local.set(values);
    fillFormFromProfile(records.profile);
    await refreshAfterRestore();
    setStatus("Restored. Check the fields above, then fill.", "ok");
  } catch (err) {
    setStatus((err && err.message) || "Could not import that file.", "warn");
  } finally {
    if (input) input.value = "";
  }
}

/** Re-read every list the options page shows, after a restore. */
async function refreshAfterRestore() {
  if (typeof loadProfiles === "function") await loadProfiles();
  if (typeof refreshProfileSelect === "function") refreshProfileSelect();
  if (typeof loadApplications === "function") await loadApplications();
  if (typeof renderApplications === "function") renderApplications();
  if (typeof loadWidgets === "function") await loadWidgets();
  if (typeof loadLearned === "function") loadLearned();
}

/** Wipe everything this extension stored, after an explicit confirmation. */
async function deleteAllData() {
  const proceed =
    typeof window.confirm !== "function" ||
    window.confirm(
      "Delete everything?\n\n" +
        "Your profile, resume file, work history, saved answers and any widgets " +
        "you taught me will be removed from this browser. This cannot be undone."
    );
  if (!proceed) {
    setStatus("Delete cancelled — nothing changed.", "warn");
    return;
  }
  try {
    deletingData = true;
    editEpoch++;
    resumeReadToken++;
    cancelAutoSave();
    // Drain already-issued writes before deletion; queued writes are invalidated.
    await profileWrites.catch(() => {});
    // Everything this extension stored: the profile, the named profiles (each
    // carrying its own resume), anything learned from typing, the remembered
    // "fields left for you" lists, the application log, and the widgets the user
    // taught us — including the OTHER PEOPLE'S details (names, emails, phones)
    // a learned References block holds as plain text. All of it goes.
    await chrome.storage.local.remove([
      STORAGE_KEY,
      LEARNED_KEY,
      RUNS_KEY,
      PROFILES_KEY,
      APPS_KEY,
      RECIPES_KEY,
      WIDGET_CANDIDATES_KEY
    ]);
  } catch (err) {
    deletingData = false;
    setStatus("Could not clear local storage.", "warn");
    return;
  }
  fillFormFromProfile({});
  profileState = { activeId: "", items: [] };
  applicationState = { items: [] };
  learnedState = { candidates: [], skipped: [] };
  recipeState = { items: [] };
  widgetCandidates = { candidates: [], skipped: [] };
  if (typeof aggregate !== "undefined") aggregate.cancel();
  if (typeof hideJobAsk === "function") hideJobAsk();
  if (typeof refreshProfileSelect === "function") refreshProfileSelect();
  if (typeof renderApplications === "function") renderApplications();
  coverTemplatesState = [];
  coverPage = null;
  for (const id of ["learnedRows", "widgetRows", "recipeRows", "unfilledList", "coverPreview"]) {
    const el = $(id);
    if (el) el.innerHTML = "";
  }
  for (const id of ["learnedSection", "widgetSection", "coverSection"]) {
    const el = $(id);
    if (el) el.hidden = true;
  }
  deletingData = false;
  setStatus("All local data deleted from this browser.", "ok");
}