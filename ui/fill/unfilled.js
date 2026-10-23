// unfilled-list.js — the "fields left for you" list and click-to-highlight:
// the labels the fill could not answer, each one a link back to its field.

/** List the fields we could not fill, so the user knows what is left. */
/** Ask the page to scroll to and flash one of the fields left for you. */
async function locateField(ref, li, frameId) {
  if (!ref) return;
  if (li) {
    li.classList.add("locating");
    setTimeout(() => li.classList.remove("locating"), 900);
  }
  if (typeof activeTabId !== "number") return;
  try {
    // Rejects when no content script answers, i.e. the page was reloaded or
    // navigated since that fill and its stored handles no longer exist. Say so
    // rather than looking like a dead click.
    const message = { type: "JOB_AUTOFILL_LOCATE", ref };
    if (typeof frameId === "number") {
      await chrome.tabs.sendMessage(activeTabId, message, { frameId });
    } else {
      await chrome.tabs.sendMessage(activeTabId, message);
    }
  } catch (err) {
    setStatus("That page has changed since the fill — press Fill Application again.", "warn");
  }
}

/**
 * List the fields we could not fill — required ones first, each clickable so
 * the user can jump straight to it on the page.
 */
function renderUnfilled(entries) {
  const list = $("unfilledList");
  if (!list) return;
  list.innerHTML = "";

  const items = (Array.isArray(entries) ? entries : []).map((entry) =>
    typeof entry === "string" ? { label: entry, required: false, ref: null } : entry
  );
  if (items.length === 0) return;

  // Required fields block submission, so they come first.
  const sorted = items
    .slice()
    .sort((a, b) => Number(!!b.required) - Number(!!a.required));
  const requiredCount = sorted.filter((entry) => entry.required).length;

  const header = document.createElement("li");
  header.className = "more";
  header.textContent = requiredCount
    ? `${sorted.length} field${sorted.length === 1 ? "" : "s"} left for you (${requiredCount} required):`
    : `${sorted.length} field${sorted.length === 1 ? "" : "s"} left for you:`;
  list.appendChild(header);

  const shown = sorted.slice(0, 6);
  for (const entry of shown) {
    const li = document.createElement("li");
    if (entry.required) li.className = "req";
    li.textContent = (entry.required ? "★ " : "") + entry.label;
    if (entry.ref) {
      li.title = "Click to highlight this field on the page";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "locate-field";
      button.textContent = li.textContent;
      li.replaceChildren(button);
      li.addEventListener("click", () => locateField(entry.ref, li, entry.frameId));
    }
    list.appendChild(li);
  }
  if (sorted.length > shown.length) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = `…and ${sorted.length - shown.length} more`;
    list.appendChild(more);
  }
}
