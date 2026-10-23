// fill-run.js — start a fill: inject the content scripts into the active tab
// and every frame, and route each frame's result into the aggregate. Also owns
// the optional broad-host-access grant offered when a frame could not be
// reached.


/**
 * Inject autofill.js into the top frame and every subframe.
 * activeTab covers the top frame's origin; host_permissions cover the
 * cross-origin ATS subframes (e.g. boards.greenhouse.io embedded in a
 * pinterestcareers.com page). matchOriginAsFallback additionally covers
 * about:blank / blob: / data: frames that inherit the embedder's origin;
 * Chrome builds that reject that property fall back to a plain allFrames run.
 */
async function injectIntoAllFrames(tabId, approveDeletion) {
  const target = { tabId, allFrames: true };
  if (approveDeletion) {
    await chrome.scripting.executeScript({ target, func: () => {
      window.__jobAutofillDeleteApproval = true;
    } });
  }
  try {
    return await chrome.scripting.executeScript({
      target,
      files: CONTENT_SCRIPTS,
      matchOriginAsFallback: true
    });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/matchOriginAsFallback/i.test(message)) {
      return await chrome.scripting.executeScript({ target, files: CONTENT_SCRIPTS });
    }
    throw err;
  }
}

// Note: the popup no longer edits the profile, so "save before you fill" can no
// longer be forgotten — the full editor auto-saves (and flushes the moment its
// tab is hidden) before the popup can be clicked.

/** The tab we last filled, so the field list can message it. */
let activeTabId = null;

async function teachActiveTab() {
  const button = $("teachBtn");
  if (button) button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") throw new Error("missing_tab");
    const target = { tabId: tab.id, allFrames: true };
    await chrome.scripting.executeScript({ target, files: CONTENT_SCRIPTS.filter((file) => file !== "content/autofill.js") });
    const results = await chrome.scripting.executeScript({ target, func: async () => {
      const JA = window.__JobAutofill;
      return !!(JA && JA.startTeaching && await JA.startTeaching());
    } });
    if (results.some((frame) => frame.result === true)) window.close();
    else setStatus("No supported labeled fields found. Open the application form and try again.", "warn");
  } catch (err) {
    setStatus("Could not open teaching on this page. Check site access and try again.", "warn");
  } finally {
    if (button) button.disabled = false;
  }
}

/** Inject the fill content script into the active tab and all of its frames. */
async function fillActiveTab() {
  // A destructive run is confirmed every single time — never silently.
  const replaceBox = $("replaceHistory");
  if (replaceBox && replaceBox.checked) {
    const proceed =
      typeof window.confirm !== "function" ||
      window.confirm(
        "Remove leftover work/education blocks on the page?\n\n" +
          "Every history block beyond your saved entries will be DELETED from " +
          "the form. Your saved profile is not affected."
      );
    if (!proceed) {
      setStatus("Cancelled — nothing was changed.", "warn");
      return;
    }
  }
  setStatus("⏳ Scanning page and frames…", "");
  aggregate.start();

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab && typeof tab.id === "number" ? tab.id : null;
  } catch (err) {
    aggregate.cancel();
    setStatus("⚠️ Could not query the active tab.", "warn");
    return;
  }

  if (!tab || typeof tab.id !== "number") {
    aggregate.cancel();
    setStatus("⚠️ No active tab available.", "warn");
    return;
  }

  try {
    const injected = await injectIntoAllFrames(tab.id, !!(replaceBox && replaceBox.checked));
    // Now that we know how many frames were reached, completion is defined:
    // render once every one of them has reported (or the deadline expires).
    aggregate.setExpected(Array.isArray(injected) ? injected.length : 1);
  } catch (err) {
    // Some pages reject allFrames injection; fall back to the top frame only
    // before giving up (e.g. restricted/sandboxed subframes).
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPTS
      });
      aggregate.setExpected(Array.isArray(injected) ? injected.length : 1);
    } catch (err2) {
      aggregate.cancel();
      setStatus("⚠️ Cannot run on this page (browser/system page).", "warn");
    }
  } finally {
    // An unreachable frame must not retain approval for some future shortcut.
    if (replaceBox && replaceBox.checked) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
          func: () => { delete window.__jobAutofillDeleteApproval; } });
      } catch (err) { /* navigation/restricted frames */ }
    }
  }
}

/** Handle a result message sent back by an injected autofill.js. */
function onAutofillResult(message, sender) {
  if (!message || message.type !== "JOB_AUTOFILL_RESULT") return;
  if (sender && sender.tab && sender.tab.id !== activeTabId) return;
  if (sender && typeof sender.frameId === "number" && Array.isArray(message.unfilled)) {
    message = Object.assign({}, message, {
      unfilled: message.unfilled.map((field) => typeof field === "object"
        ? Object.assign({}, field, { frameId: sender.frameId }) : field)
    });
  }
  aggregate.add(message);
}
/** Origin pattern for the optional "fill anywhere" permission. */
const ANY_SITE_ORIGINS = ["*://*/*"];

/**
 * Offer the optional broad host access when part of the page is in a frame we
 * could not reach (an embedded ATS whose domain is not pre-listed). Purely
 * opt-in: nothing is requested until the user clicks, and the extension still
 * does nothing until Fill is pressed.
 */
async function showGrantRow(want) {
  const row = $("grantRow");
  if (!row) return;
  if (!want || !chrome.permissions) {
    row.hidden = true;
    return;
  }
  try {
    const already = await chrome.permissions.contains({
      origins: ANY_SITE_ORIGINS
    });
    if (already) {
      row.hidden = true;
      return;
    }
  } catch (err) {
    /* permissions API unavailable — still offer the button */
  }
  row.hidden = false;
}

/** Ask for broad host access, then tell the user to press Fill again. */
async function requestAnySiteAccess() {
  try {
    const granted = await chrome.permissions.request({
      origins: ANY_SITE_ORIGINS
    });
    if (granted) {
      const row = $("grantRow");
      if (row) row.hidden = true;
      setStatus("✅ Access granted — press Fill again to fill the embedded frame.", "ok");
    } else {
      setStatus("Access not granted — the embedded frame will stay unfilled.", "warn");
    }
  } catch (err) {
    setStatus("⚠️ Could not request permission on this page.", "error");
  }
}
