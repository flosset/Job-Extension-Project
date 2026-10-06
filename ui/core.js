// core.js — shared constants + DOM helpers for the Private Job Autofill UI.
// Loaded FIRST; storage.js, fill-runner.js and editor.js all depend on it.

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
  "fullName",
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
