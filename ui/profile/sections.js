// profile-sections.js — the repeatable editor rows on the profile pages: the
// answer-bank snippets (feature 4) and the Work Experience / Education cards.
// Every row schedules an auto-save through profileChanged() when it is edited.

// --- Custom snippets (feature 4) -----------------------------------------

/** Render the saved custom-snippet rows into the popup. */
function renderSnippets(snippets) {
  const container = $("snippetRows");
  container.innerHTML = "";
  const list = Array.isArray(snippets) ? snippets : [];
  if (list.length === 0) return;
  for (const snippet of list) {
    addSnippetRow((snippet && snippet.key) || "", (snippet && snippet.value) || "");
  }
}

/** Add one editable Key/Value row (built with the DOM API, never innerHTML). */
function addSnippetRow(key, value) {
  const container = $("snippetRows");

  const row = document.createElement("div");
  row.className = "snip-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "snip-key";
  keyInput.placeholder = "salary";
  keyInput.value = key;

  const valueInput = document.createElement("textarea");
  valueInput.className = "snip-value";
  valueInput.rows = 2;
  valueInput.placeholder = "Short answer, or paste a long paragraph…";
  valueInput.value = value;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "snip-del";
  remove.title = "Remove snippet";
  remove.textContent = "×";
  remove.addEventListener("click", () => { row.remove(); profileChanged(); });

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(remove);
  container.appendChild(row);
}

/** Read the snippet rows back into a [{key, value}] array (blanks dropped). */
function collectSnippets() {
  const out = [];
  document.querySelectorAll("#snippetRows .snip-row").forEach((row) => {
    const key = (row.querySelector(".snip-key").value || "").trim();
    const value = (row.querySelector(".snip-value").value || "").trim();
    if (key && value) out.push({ key, value });
  });
  return out;
}

// --- Work Experience (repeatable section) --------------------------------

/** Render saved work-experience entries into the popup. */
function renderExperiences(list) {
  const container = $("expRows");
  container.innerHTML = "";
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) addExperienceRow(entry || {});
}

// --- Repeatable card helpers ---------------------------------------------

/** Create a card (header + grid) inside `container`; returns the grid. */
function buildCard(container, title) {
  const card = document.createElement("div");
  card.className = "exp-card";

  const head = document.createElement("div");
  head.className = "exp-head";
  const caption = document.createElement("span");
  caption.className = "exp-caption";
  caption.textContent = title;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "snip-del";
  remove.title = "Remove";
  remove.textContent = "×";
  remove.addEventListener("click", () => { card.remove(); profileChanged(); });
  head.appendChild(caption);
  head.appendChild(remove);

  const grid = document.createElement("div");
  grid.className = "exp-grid";

  card.appendChild(head);
  card.appendChild(grid);
  container.appendChild(card);
  return grid;
}

/** One labelled text input inside a card grid. */
function addCardField(grid, labelText, cls, value, full) {
  const wrap = document.createElement("div");
  wrap.className = "field" + (full ? " full" : "");
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.className = cls;
  input.value = value || "";
  wrap.appendChild(label);
  wrap.appendChild(input);
  grid.appendChild(wrap);
  return input;
}

/** One labelled textarea inside a card grid. */
function addCardTextarea(grid, labelText, cls, value, rows) {
  const wrap = document.createElement("div");
  wrap.className = "field full";
  const label = document.createElement("label");
  label.textContent = labelText;
  const area = document.createElement("textarea");
  area.className = cls;
  area.rows = rows || 3;
  area.value = value || "";
  wrap.appendChild(label);
  wrap.appendChild(area);
  grid.appendChild(wrap);
  return area;
}

/** Add one work-experience card (built with the DOM API, never innerHTML). */
function addExperienceRow(entry) {
  entry = entry || {};
  const grid = buildCard($("expRows"), "Experience");

  addCardField(grid, "Job Title", "exp-title", entry.title);
  addCardField(grid, "Company", "exp-company", entry.company);
  addCardField(grid, "Location", "exp-location", entry.location, true);
  addCardField(grid, "From (MM/YYYY)", "exp-from", entry.from);
  addCardField(grid, "To (MM/YYYY)", "exp-to", entry.to);
  addCardTextarea(grid, "Role Description", "exp-desc", entry.description, 3);

  const currentWrap = document.createElement("label");
  currentWrap.className = "exp-current";
  const current = document.createElement("input");
  current.type = "checkbox";
  current.className = "exp-current-box";
  current.checked = !!entry.current;
  currentWrap.appendChild(current);
  currentWrap.appendChild(document.createTextNode(" I currently work here"));
  grid.appendChild(currentWrap);
}

// --- Education (repeatable section) --------------------------------------

/** Render saved education entries into the popup. */
function renderEducations(list) {
  const container = $("eduRows");
  container.innerHTML = "";
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) addEducationRow(entry || {});
}

/** Add one education card. */
function addEducationRow(entry) {
  entry = entry || {};
  const grid = buildCard($("eduRows"), "Education");

  addCardField(grid, "School or University", "edu-school", entry.school, true);
  addCardField(grid, "Degree", "edu-degree", entry.degree, true);
  addCardField(grid, "Field of Study", "edu-major", entry.major, true);
  addCardField(grid, "Overall Result (GPA)", "edu-gpa", entry.gpa);
  addCardField(grid, "From (YYYY)", "edu-from", entry.from);
  addCardField(grid, "To (YYYY)", "edu-to", entry.to);
}

/** Read the cards back into an array of entries (blank cards dropped). */
function collectExperiences() {
  const out = [];
  document.querySelectorAll("#expRows .exp-card").forEach((card) => {
    const read = (cls) => (card.querySelector(cls).value || "").trim();
    const entry = {
      title: read(".exp-title"),
      company: read(".exp-company"),
      location: read(".exp-location"),
      from: read(".exp-from"),
      to: read(".exp-to"),
      description: read(".exp-desc"),
      current: !!card.querySelector(".exp-current-box").checked
    };
    if (entry.title || entry.company) out.push(entry);
  });
  return out;
}

/** Read the education cards back into an array of entries. */
function collectEducations() {
  const out = [];
  document.querySelectorAll("#eduRows .exp-card").forEach((card) => {
    const read = (cls) => (card.querySelector(cls).value || "").trim();
    const entry = {
      school: read(".edu-school"),
      degree: read(".edu-degree"),
      major: read(".edu-major"),
      gpa: read(".edu-gpa"),
      from: read(".edu-from"),
      to: read(".edu-to")
    };
    if (entry.school || entry.degree) out.push(entry);
  });
  return out;
}
