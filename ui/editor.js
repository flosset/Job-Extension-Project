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
  loadProfile();
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
  loadLearned();

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
