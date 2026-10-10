// learned.js — the review step for "learn from what you type".
//
// The content script only ever stores CANDIDATES (under its own storage key);
// the answer bank itself is written here, on an explicit click, exactly like a
// hand-typed bank entry. Accepting a candidate appends {key, value} to
// customSnippets and drops it from the pending list, so the same question can
// never be added twice.

"use strict";

/** The pending candidates, as sanitized by shared/. */
let learnedState = { candidates: [], skipped: [] };

/** Read the candidates the content script left behind. */
async function loadLearned() {
  const epoch = editEpoch;
  try {
    const data = await chrome.storage.local.get(LEARNED_KEY);
    if (epoch !== editEpoch || deletingData) return;
    learnedState = JOB_AUTOFILL_SHARED.sanitizeLearned(data[LEARNED_KEY]);
  } catch (err) {
    learnedState = { candidates: [], skipped: [] };
  }
  renderLearned();
}

/** Persist the pending list (what the user has not dealt with yet). */
async function storeLearned() {
  try {
    await chrome.storage.local.set({ [LEARNED_KEY]: learnedState });
  } catch (err) {
    /* nothing else we can do — the bank itself is untouched either way */
  }
}

/** The answer bank as THIS page sees it (unsaved edits included). */
function bankOnPage() {
  if ($("snippetRows")) return collectSnippets();
  return Array.isArray(storedProfile.customSnippets)
    ? storedProfile.customSnippets
    : [];
}

/** Show the candidates as editable Key / Value rows. */
function renderLearned() {
  const section = $("learnedSection");
  if (!section) return;
  const candidates = learnedState.candidates || [];
  section.hidden = candidates.length === 0;

  const rows = $("learnedRows");
  if (rows) {
    rows.innerHTML = "";
    candidates.forEach((candidate) => addLearnedRow(candidate));
  }

  const note = $("learnedNote");
  if (note) {
    const skipped = (learnedState.skipped || []).length;
    note.textContent =
      "Answers you typed into the fields this extension left for you. " +
      "Nothing is saved until you click Save; they stay in this browser." +
      (skipped
        ? ` ${skipped} question${skipped === 1 ? "" : "s"} ${
            skipped === 1 ? "was" : "were"
          } answered differently in two places and left alone.`
        : "");
  }
}

/** One editable candidate row. Built with the DOM API, never innerHTML. */
function addLearnedRow(candidate) {
  const container = $("learnedRows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "snip-row learn-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "snip-key";
  keyInput.value = candidate.question;
  keyInput.title = candidate.site
    ? `Keyword for the question you answered on ${candidate.site}`
    : "Keyword that matches this question";

  const valueInput = document.createElement("textarea");
  valueInput.className = "snip-value";
  valueInput.rows = 2;
  valueInput.value = candidate.value;

  const save = document.createElement("button");
  save.type = "button";
  save.className = "learn-save";
  save.textContent = "Save";
  save.title = "Add this to the answer bank";
  save.addEventListener("click", () => saveLearned(candidate, keyInput, valueInput));

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "snip-del";
  skip.textContent = "×";
  skip.title = "Do not save this answer";
  skip.addEventListener("click", () => dismissLearned(candidate));

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(save);
  row.appendChild(skip);
  container.appendChild(row);
}

/** Remove one candidate from the pending list (accepted OR dismissed). */
async function dropLearned(candidate) {
  const key = JOB_AUTOFILL_SHARED.keyOf(candidate.question);
  learnedState = {
    candidates: (learnedState.candidates || []).filter(
      (entry) => JOB_AUTOFILL_SHARED.keyOf(entry.question) !== key
    ),
    skipped: learnedState.skipped || []
  };
  await storeLearned();
  renderLearned();
}

/**
 * Accept one candidate: append it to the bank, then drop it from the pending
 * list. The keyword and the value come from the row, so the user can shorten a
 * long question into the wording the next portal actually uses.
 */
async function saveLearned(candidate, keyInput, valueInput) {
  const key = (keyInput.value || "").trim();
  const value = (valueInput.value || "").trim();
  if (!key || !value) {
    setStatus("Give that answer a keyword and a value first.", "warn");
    return;
  }

  const profile = readForm(); // this page's view, merged over what is stored
  const bank = Array.isArray(profile.customSnippets)
    ? profile.customSnippets.slice()
    : [];

  // Same rule as the content script: never two entries for one question.
  if (JOB_AUTOFILL_SHARED.bankCovers(bank, key)) {
    await dropLearned(candidate);
    setStatus("That question is already in your answer bank.", "warn");
    return;
  }

  bank.push({ key, value });
  profile.customSnippets = bank;
  await persist(profile);
  if ($("snippetRows")) renderSnippets(bank); // show it in the editor below
  await dropLearned(candidate);
  setStatus("Saved to your answer bank.", "ok");
}

/** Decline one candidate. */
async function dismissLearned(candidate) {
  await dropLearned(candidate);
  setStatus("Not saved.", "");
}

/** Accept every visible row at once, honouring the same dedupe rule. */
async function saveAllLearned() {
  const rows = Array.from(document.querySelectorAll("#learnedRows .learn-row"));
  if (rows.length === 0) return;

  const profile = readForm();
  const bank = Array.isArray(profile.customSnippets)
    ? profile.customSnippets.slice()
    : [];

  let added = 0;
  for (const row of rows) {
    const key = (row.querySelector(".snip-key").value || "").trim();
    const value = (row.querySelector(".snip-value").value || "").trim();
    if (!key || !value) continue;
    if (JOB_AUTOFILL_SHARED.bankCovers(bank, key)) continue; // already covered
    bank.push({ key, value });
    added++;
  }

  if (added === 0) {
    setStatus("Nothing new to save.", "warn");
    return;
  }

  profile.customSnippets = bank;
  await persist(profile);
  if ($("snippetRows")) renderSnippets(bank);
  learnedState = { candidates: [], skipped: learnedState.skipped || [] };
  await storeLearned();
  renderLearned();
  setStatus(`Saved ${added} answer${added === 1 ? "" : "s"} to your answer bank.`, "ok");
}

/** Decline every candidate at once. */
async function dismissAllLearned() {
  if ((learnedState.candidates || []).length === 0) return;
  learnedState = { candidates: [], skipped: learnedState.skipped || [] };
  await storeLearned();
  renderLearned();
  setStatus("Nothing saved.", "");
}

