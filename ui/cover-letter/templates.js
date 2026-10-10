// templates.js — the options page's template editor: one editable row per
// saved cover letter, and reading those rows back into the profile.
"use strict";

// --- The options page's template editor ------------------------------------

/** One editable template row (built with the DOM API, never innerHTML). */
function addTemplateRow(name, body) {
  const container = $("templateRows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "tpl-row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "tpl-name";
  nameInput.placeholder = "Frontend";
  nameInput.value = name || "";

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "tpl-body";
  bodyInput.rows = 6;
  bodyInput.placeholder =
    "Dear {company} team,\n\nI would like to apply for the {role} role…";
  bodyInput.value = body || "";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "snip-del";
  remove.title = "Remove template";
  remove.textContent = "×";
  remove.addEventListener("click", () => { row.remove(); profileChanged(); });

  const head = document.createElement("div");
  head.className = "tpl-head";
  head.appendChild(nameInput);
  head.appendChild(remove);

  row.appendChild(head);
  row.appendChild(bodyInput);
  container.appendChild(row);
}

/** Render the stored templates into the editor. */
function renderTemplates(list) {
  const container = $("templateRows");
  if (!container) return;
  container.innerHTML = "";
  for (const template of coverTemplates({ coverLetterTemplates: list })) {
    addTemplateRow(template.name, template.body);
  }
}

/** Read the template rows back out (blank bodies dropped). */
function collectTemplates() {
  const out = [];
  const container = $("templateRows");
  if (!container) return out;
  container.querySelectorAll(".tpl-row").forEach((row) => {
    const name = (row.querySelector(".tpl-name").value || "").trim();
    const body = (row.querySelector(".tpl-body").value || "").trim();
    if (!body) return;
    out.push({ id: JOB_AUTOFILL_SHARED.newId(), name: name.slice(0, 40), body });
  });
  return out;
}
