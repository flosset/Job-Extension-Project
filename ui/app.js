// app.js — bootstrap. Wires the controls on whichever page loaded it
// (popup.html or options.html), registers the fill-result listener, and kicks
// off the initial loads. It is loaded LAST, after every function it wires.
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
