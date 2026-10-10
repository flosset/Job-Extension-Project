// profiles.js — named profiles: "Frontend", "Full-stack", "US address"…
//
// A profile is a COMPLETE copy of the profile object, including its own resume,
// so "which resume do I send here" is answered by picking a profile. The ACTIVE
// profile is mirrored into the jobProfile key — the single record the injected
// script reads — so switching profiles needs no change to the fill engine and
// cannot leave the two halves disagreeing about what to fill.

"use strict";

// PROFILES_KEY comes from ui/core.js — it owns the storage keys, exactly as it
// already does for the profile, the learned answers and the remembered runs.

/** The profiles as last read: { activeId, items: [{ id, name, profile }] }. */
let profileState = { activeId: "", items: [] };

/** Read them, adopting a v1 single profile the first time. */
async function loadProfiles() {
  const epoch = editEpoch;
  try {
    const data = await chrome.storage.local.get([PROFILES_KEY, STORAGE_KEY]);
    if (epoch !== editEpoch || deletingData) return profileState;
    profileState = JOB_AUTOFILL_SHARED.sanitizeProfiles(
      data[PROFILES_KEY],
      data[STORAGE_KEY]
    );
    // First run on a v1 install: persist the adopted profile so the list exists
    // from now on rather than being re-derived on every open.
    if (!data[PROFILES_KEY] && profileState.items.length) {
      await chrome.storage.local.set({ [PROFILES_KEY]: profileState });
    }
  } catch (err) {
    /* the popup still fills from jobProfile — profiles are a convenience */
  }
  return profileState;
}

/** The active profile item, or null. */
function activeProfile() {
  return profileState.items.find((item) => item.id === profileState.activeId) || null;
}

/** Persist the list, optionally making `activateId` the active profile. */
async function writeProfiles(activateId) {
  if (activateId) profileState.activeId = activateId;
  const active = activeProfile();
  try {
    const values = { [PROFILES_KEY]: profileState };
    if (active) values[STORAGE_KEY] = active.profile;
    await chrome.storage.local.set(values);
    return true;
  } catch (err) {
    return false;
  }
}

/** Make `id` the profile the next fill uses. */
async function activateProfile(id) {
  if (!profileState.items.some((item) => item.id === id)) return false;
  return writeProfiles(id);
}

/** The stored jobProfile, straight from storage. */
async function currentStoredProfile() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object"
      ? data[STORAGE_KEY]
      : {};
  } catch (err) {
    return {};
  }
}

/** Snapshot the CURRENT profile under a name — a new profile. */
async function createProfileFromCurrent(name) {
  if (profileState.items.length >= JOB_AUTOFILL_SHARED.maxProfiles) {
    return { ok: false, reason: "limit" };
  }
  const clean = (name || "").trim();
  const item = {
    id: JOB_AUTOFILL_SHARED.newId(),
    name: (clean || `Profile ${profileState.items.length + 1}`).slice(0, 40),
    profile: await currentStoredProfile()
  };
  profileState.items.push(item);
  const ok = await writeProfiles(item.id);
  return ok ? { ok: true, id: item.id } : { ok: false, reason: "storage" };
}

/** Copy an existing profile under a new name. */
async function duplicateProfile(id) {
  const source = profileState.items.find((item) => item.id === id);
  if (!source) return { ok: false, reason: "missing" };
  if (profileState.items.length >= JOB_AUTOFILL_SHARED.maxProfiles) {
    return { ok: false, reason: "limit" };
  }
  const copy = {
    id: JOB_AUTOFILL_SHARED.newId(),
    name: `${source.name} copy`.slice(0, 40),
    // A deep copy, so editing one profile can never reach into the other.
    profile: JSON.parse(JSON.stringify(source.profile))
  };
  profileState.items.push(copy);
  const ok = await writeProfiles(copy.id);
  return ok ? { ok: true, id: copy.id } : { ok: false, reason: "storage" };
}

/** Rename one profile. */
async function renameProfile(id, name) {
  const item = profileState.items.find((entry) => entry.id === id);
  const clean = (name || "").trim();
  if (!item || !clean) return false;
  item.name = clean.slice(0, 40);
  return writeProfiles();
}

/** Remove one profile. The last one cannot be removed. */
async function deleteProfile(id) {
  if (profileState.items.length <= 1) return { ok: false, reason: "last" };
  profileState.items = profileState.items.filter((item) => item.id !== id);
  const next =
    profileState.activeId === id ? profileState.items[0].id : profileState.activeId;
  const ok = await writeProfiles(next);
  return ok ? { ok: true } : { ok: false, reason: "storage" };
}

/**
 * Save the profile the editor is showing back into the ACTIVE profile item, so
 * the list and the live jobProfile never drift apart after an edit.
 */
async function syncActiveProfile(profile) {
  const active = activeProfile();
  if (!active || !profile) return false;
  active.profile = profile;
  try {
    await chrome.storage.local.set({ [PROFILES_KEY]: profileState });
    return true;
  } catch (err) {
    return false;
  }
}

/** Fill the profile picker on whichever page has one. */
function refreshProfileSelect() {
  const select = $("profileSelect");
  if (!select) return;
  select.innerHTML = "";
  for (const item of profileState.items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  }
  if (profileState.activeId) select.value = profileState.activeId;
  select.disabled = profileState.items.length === 0;
}