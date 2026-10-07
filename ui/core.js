// core.js — shared constants + DOM helpers for the Private Job Autofill UI.
// Loaded FIRST; storage.js, fill-runner.js and editor.js all depend on it.

"use strict";

// The two storage keys, and the injected script list, come from shared.js —
// it is loaded before this file by both pages, imported by the service worker
// and injected into the page as the first content script, so the popup, the
// shortcut handler and the fill itself can never disagree about them.
const STORAGE_KEY = JOB_AUTOFILL_SHARED.keys.profile;
const LEARNED_KEY = JOB_AUTOFILL_SHARED.keys.learned;
const RUNS_KEY = JOB_AUTOFILL_SHARED.keys.runs;
const PROFILES_KEY = JOB_AUTOFILL_SHARED.keys.profiles;
const APPS_KEY = JOB_AUTOFILL_SHARED.keys.applications;
// Remembered widgets: the pending "remember this widget?" offers, and the saved
// definitions the fill pipeline replays first.
const RECIPES_KEY = JOB_AUTOFILL_SHARED.keys.recipes;
const WIDGET_CANDIDATES_KEY = JOB_AUTOFILL_SHARED.keys.widgetCandidates;

// The injected content scripts, in load order. They share the
// window.__JobAutofill namespace inside the page's isolated world, so the
// order matters: shared data → helpers → widgets → learning → orchestrator.
const CONTENT_SCRIPTS = JOB_AUTOFILL_SHARED.contentScripts;

// Every field id in popup.html that maps 1:1 to a key in the stored profile.
const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "phoneCountry",
  "phoneNational",
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
