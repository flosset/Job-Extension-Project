// letter.js — cover-letter templates with {company} / {role} placeholders.
//
// A letter is composed per application, so nothing here is part of an ordinary
// fill: the popup shows the finished text, and the user copies it or asks for it
// to be typed into the form. Placeholders come from the job this page is for,
// which the content script reports as `page` with every fill.
//
// Editing the template list is the other half, in templates.js.

/** Templates on a profile, coerced to [{ id, name, body }] (blanks dropped). */
function coverTemplates(profile) {
  const list =
    profile && Array.isArray(profile.coverLetterTemplates)
      ? profile.coverLetterTemplates
      : [];
  const out = [];
  for (const item of list) {
    const entry = item && typeof item === "object" ? item : {};
    const body = typeof entry.body === "string" ? entry.body : "";
    if (!body.trim()) continue;
    out.push({
      // A stable fallback id, so reading twice does not churn ids.
      id: typeof entry.id === "string" && entry.id ? entry.id : "t" + out.length,
      name: (typeof entry.name === "string" ? entry.name.trim() : "") ||
        "Template " + (out.length + 1),
      body
    });
  }
  return out;
}

/** The values a template can use. `page` may be null (no fill yet on this tab). */
function templateValues(profile, page) {
  const p = profile || {};
  const full = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" ");
  return {
    firstName: p.firstName || "",
    fullName: full,
    email: p.email || "",
    phone: p.phone || "",
    city: p.city || "",
    company: (page && page.company) || "",
    role: (page && page.role) || "",
    today: new Date().toLocaleDateString()
  };
}

/** Placeholders a template may use (the editor prints this list). */
const TEMPLATE_PLACEHOLDERS = [
  "company", "role", "firstName", "fullName",
  "email", "phone", "city", "today"
];

/**
 * Fill {placeholders} in a template.
 *
 * An UNKNOWN placeholder is left exactly as written rather than becoming an
 * empty string: a typo should be visible in the preview, not silently produce
 * a letter with a hole in it that you then send.
 */
function renderTemplate(body, values) {
  const map = values && typeof values === "object" ? values : {};
  const names = Object.keys(map);
  return String(body == null ? "" : body).replace(
    /\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}/g,
    (whole, key) => {
      const wanted = key.toLowerCase();
      for (const name of names) {
        if (name.toLowerCase() === wanted) {
          const value = map[name];
          return value == null ? "" : String(value);
        }
      }
      return whole; // unknown placeholder — keep it visible
    }
  );
}

/** The finished letter text for one template. */
function composeCoverLetter(template, profile, page) {
  if (!template || typeof template.body !== "string") return "";
  return renderTemplate(template.body, templateValues(profile, page));
}

/**
 * The job info for the active tab. The last fill's page info is exact; before
 * any fill we fall back to the tab's own title, and {company} stays EMPTY rather
 * than being guessed from the hostname — a letter must not open "Dear
 * Greenhouse,".
 */
async function pageForTab() {
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return null;
  }
  if (!tab || typeof tab.id !== "number") return null;

  try {
    const runs = await readRuns();
    const record = runs[String(tab.id)];
    const page = record && record.results && record.results.page;
    if (page && (page.company || page.role)) return page;
  } catch (err) {
    /* fall through to the coarse guess */
  }

  const title = typeof tab.title === "string" ? tab.title : "";
  return {
    company: "",
    role: title.split(/\s+[|–—-]\s+/)[0].trim(),
    url: typeof tab.url === "string" ? tab.url : "",
    host: "",
    confident: false
  };
}

// --- The popup's cover-letter section --------------------------------------

let coverTemplatesState = [];
let coverPage = null;

/** Build the template picker and the live preview. */
async function refreshCoverLetter() {
  const section = $("coverSection");
  const select = $("coverTemplate");
  if (!section || !select) return; // not the popup

  coverTemplatesState = coverTemplates(storedProfile);
  if (coverTemplatesState.length === 0) {
    section.hidden = true;
    return;
  }
  coverPage = await pageForTab();

  const previous = select.value;
  select.innerHTML = "";
  coverTemplatesState.forEach((template, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = template.name;
    select.appendChild(option);
  });
  if (previous && Number(previous) < coverTemplatesState.length) {
    select.value = previous;
  }
  section.hidden = false;
  renderCoverPreview();
}

/** The letter as it currently stands. */
function selectedCoverText() {
  const select = $("coverTemplate");
  const index = select ? Number(select.value) || 0 : 0;
  return composeCoverLetter(coverTemplatesState[index], storedProfile, coverPage);
}

/** Show the exact text that would be copied or typed. */
function renderCoverPreview() {
  const preview = $("coverPreview");
  if (preview) preview.textContent = selectedCoverText();
  const note = $("coverNote");
  if (!note) return;
  const missing = [];
  if (coverPage && !coverPage.company) missing.push("{company}");
  if (coverPage && !coverPage.role) missing.push("{role}");
  note.textContent = missing.length
    ? `No job details on this page yet, so ${missing.join(" and ")} stay as written.`
    : "";
}

/** Copy the letter to the clipboard. */
async function copyCoverLetter() {
  const text = selectedCoverText();
  if (!text.trim()) {
    setStatus("Nothing to copy — pick a template first.", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("📋 Cover letter copied — paste it where the form asks.", "ok");
  } catch (err) {
    setStatus("Could not reach the clipboard — select the preview and copy it.", "warn");
  }
}

/** Ask the page to type the letter into its cover-letter box. */
async function typeCoverLetter() {
  const text = selectedCoverText();
  if (!text.trim()) {
    setStatus("Nothing to type — pick a template first.", "warn");
    return;
  }
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    tab = null;
  }
  if (!tab || typeof tab.id !== "number") {
    setStatus("⚠️ No active tab available.", "warn");
    return;
  }

  const message = { type: "JOB_AUTOFILL_COVER_LETTER", text };
  try {
    // The top frame first, so the answer is unambiguous…
    const answer = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
    if (answer && answer.ok) {
      setStatus("✍️ Cover letter typed into the form.", "ok");
      return;
    }
    // …then every frame, for boards that embed the form.
    const anywhere = await chrome.tabs.sendMessage(tab.id, message);
    if (anywhere && anywhere.ok) {
      setStatus("✍️ Cover letter typed into the embedded form.", "ok");
      return;
    }
    setStatus("No cover-letter box on this page — use Copy instead.", "warn");
  } catch (err) {
    setStatus("Press Fill Application once on this page first, then try again.", "warn");
  }
}
