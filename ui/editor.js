// editor.js — bootstrap: wires the controls on whichever page loaded it
// (popup.html or options.html) and registers the fill-result listener.

"use strict";

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
  // Wiring happens FIRST and synchronously: the loads further down are
  // asynchronous, and a control that is not wired yet is a control that does
  // nothing when it is clicked.
  on("saveBtn", "click", saveProfile);
  on("fillBtn", "click", fillActiveTab);
  on("editProfileBtn", "click", openOptionsPage);
  on("grantBtn", "click", requestAnySiteAccess);
  on("exportBtn", "click", exportProfile);
  on("importBtn", "click", () => {
    const input = $("importFile");
    if (input) input.click();
  });
  on("importFile", "change", onImportFilePicked);
  on("deleteAllBtn", "click", deleteAllData);

  // "Learn from what you type": the content script leaves candidates behind, so
  // show them on whichever page just opened and let the user accept them.
  on("saveLearnedAllBtn", "click", saveAllLearned);
  on("dismissLearnedAllBtn", "click", dismissAllLearned);

  // Named profiles, the application log, and cover-letter templates.
  on("profileSelect", "change", switchProfile);
  on("profileNewBtn", "click", createNewProfile);
  on("profileRenameBtn", "click", renameActiveProfile);
  on("profileDupBtn", "click", duplicateActiveProfile);
  on("profileDeleteBtn", "click", deleteActiveProfile);
  on("addTemplateBtn", "click", () => addTemplateRow("", ""));
  on("coverTemplate", "change", renderCoverPreview);
  on("coverCopyBtn", "click", copyCoverLetter);
  on("coverTypeBtn", "click", typeCoverLetter);
  on("exportAppsBtn", "click", exportApplications);
  on("clearAppsBtn", "click", clearApplicationsWithConfirm);

  // The "which job is this?" question, asked only when the page could not say.
  on("askSaveBtn", "click", saveJobAsk);
  on("askSkipBtn", "click", dismissJobAsk);

  // "Remember this widget": the offers the content script left behind, and the
  // saved definitions (which the fill replays before anything else).
  on("saveWidgetsBtn", "click", saveAllWidgets);
  on("dismissWidgetsBtn", "click", dismissAllWidgets);

  // Any edit in the form means what is on screen differs from what is stored.
  on("profileForm", "input", profileChanged);
  on("profileForm", "change", profileChanged);

  // The popup owns nothing but the "replace history" preference, so persist
  // that the moment it is toggled.
  on("replaceHistory", "change", () => {
    if (!autoSaveEnabled) autoSave();
  });

  // The full editor (options.html) saves as you type; the popup does not.
  autoSaveEnabled = !!(document.body && document.body.dataset.page === "options");
  if (autoSaveEnabled) {
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

  // Sections read each other's data, so load the shared pieces first and render
  // the parts that depend on them once they are actually in.
  loadLearned();
  Promise.all([
    loadProfiles(),
    loadProfile(),
    loadApplications(),
    loadWidgets()
  ]).then(() => {
    refreshProfileSelect();
    refreshCoverLetter();
    renderApplications();
    // The popup is a fresh document on every open, so rebuild the "fields left
    // for you" list from the last run on this tab instead of losing it.
    restoreRun();
    // Warn BEFORE any fill if this tab is a posting already in the log.
    if (typeof checkDuplicateOnOpen === "function") checkDuplicateOnOpen();
  });

  // The active profile can also be switched from another page (the popup's
  // picker). Reload rather than let this page save its stale copy over it.
  watchProfileSwitch();
});

/** Switch the active profile — the picker exists on both pages. */
async function switchProfile() {
  const select = $("profileSelect");
  if (!select) return;

  // A pending auto-save belongs to the profile being LEFT; letting it fire after
  // the switch would write this form's values into the profile just chosen.
  const nextId = select.value;
  await flushAutoSave();
  resumeReadToken++;
  const ok = await activateProfile(nextId);
  if (!ok) {
    setStatus("Could not switch profile.", "warn");
    refreshProfileSelect();
    return;
  }
  // The editor shows the active profile's fields, so show the new ones.
  await loadProfile();
  refreshProfileSelect();
  await refreshCoverLetter();
  setStatus(`Now using “${(activeProfile() || {}).name || "profile"}”.`, "ok");
}

/** Create a new profile from what is on screen, and switch to it. */
async function createNewProfile() {
  const name = window.prompt("Name this new profile", "New profile");
  if (name === null) return;
  const result = await createProfileFromCurrent(name);
  if (!result.ok) {
    setStatus(
      result.reason === "limit"
        ? `At most ${JOB_AUTOFILL_SHARED.maxProfiles} profiles.`
        : "Could not create that profile.",
      "warn"
    );
    return;
  }
  await loadProfile();
  refreshProfileSelect();
  await refreshCoverLetter();
  setStatus("New profile created — edit it freely.", "ok");
}

/** Rename the active profile. */
async function renameActiveProfile() {
  const active = activeProfile();
  if (!active) return;
  const name = window.prompt("Name this profile", active.name);
  if (name === null) return;
  const ok = await renameProfile(active.id, name);
  refreshProfileSelect();
  setStatus(ok ? "Renamed." : "Could not rename that profile.", ok ? "ok" : "warn");
}

/** Copy the active profile, so a variation can be edited freely. */
async function duplicateActiveProfile() {
  const active = activeProfile();
  if (!active) return;
  const result = await duplicateProfile(active.id);
  if (!result.ok) {
    setStatus(
      result.reason === "limit"
        ? `At most ${JOB_AUTOFILL_SHARED.maxProfiles} profiles.`
        : "Could not duplicate that profile.",
      "warn"
    );
    return;
  }
  await loadProfile();
  refreshProfileSelect();
  setStatus("Duplicated — edit this copy freely.", "ok");
}

/** Delete the active profile, after an explicit confirmation. */
async function deleteActiveProfile() {
  const active = activeProfile();
  if (!active) return;
  const proceed =
    typeof window.confirm !== "function" ||
    window.confirm(
      `Delete the profile “${active.name}”?\n\n` +
        "Everything in it, including its resume, is removed. Your other " +
        "profiles are untouched."
    );
  if (!proceed) {
    setStatus("Cancelled — nothing was deleted.", "warn");
    return;
  }
  const result = await deleteProfile(active.id);
  if (!result.ok) {
    setStatus(
      result.reason === "last"
        ? "The last profile cannot be deleted."
        : "Could not delete that profile.",
      "warn"
    );
    return;
  }
  await loadProfile();
  refreshProfileSelect();
  await refreshCoverLetter();
  setStatus("Profile deleted.", "ok");
}

/** Wipe the application log, after an explicit confirmation. */
async function clearApplicationsWithConfirm() {
  const proceed =
    typeof window.confirm !== "function" ||
    window.confirm(
      "Clear your whole application log?\n\n" +
        "This removes the log only — your profile and resumes are untouched."
    );
  if (!proceed) {
    setStatus("Cancelled — the log is unchanged.", "warn");
    return;
  }
  await clearApplications();
  renderApplications();
  setStatus("Application log cleared.", "ok");
}

/**
 * Another page may switch the active profile (the popup's picker). Reload this
 * editor when that happens, so it cannot save the profile it was showing over
 * the one just chosen. A change to the CONTENT of the active profile is ignored
 * — that is this page saving, and reloading would fight the user's typing.
 */
function watchProfileSwitch() {
  if (!chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[PROFILES_KEY]) return;
    const next = changes[PROFILES_KEY].newValue;
    if (!next) {
      editEpoch++;
      resumeReadToken++;
      cancelAutoSave();
      profileState = { activeId: "", items: [] };
      fillFormFromProfile({});
      refreshProfileSelect();
      return;
    }
    const activeId = next && typeof next.activeId === "string" ? next.activeId : "";
    if (!activeId || activeId === profileState.activeId) return;
    cancelAutoSave();
    loadProfiles().then(() => {
      loadProfile();
      refreshProfileSelect();
      refreshCoverLetter();
    });
  });
}
