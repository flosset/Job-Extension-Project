// actions.js — the profile buttons: switch, create, rename, duplicate and
// delete. Each one confirms where it must, then re-reads the profile so the
// page always shows what is actually stored. app.js wires these.
"use strict";

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
  await flushAutoSave();
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
  await flushAutoSave();
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
