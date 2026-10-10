// files.js — flags resume/CV file-upload drop zones. Browser security forbids
// programmatically setting a file input's value, so instead of filling it we
// give the field a flashing thick green outline marking exactly where to drop
// the file. The outline clears itself once a file is chosen.
(() => {
  "use strict";
  const JA = (window.__JobAutofill = window.__JobAutofill || {});
  const STYLE_ID = "__jobAutofillFileStyle";

  /** Inject the pulse animation once per page/frame. */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "@keyframes jaFilePulse {",
      "  0%, 100% { outline-color: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.35); }",
      "  50%      { outline-color: #86efac; box-shadow: 0 0 0 7px rgba(134, 239, 172, 0.30); }",
      "}",
      "[data-ja-dropzone] {",
      "  outline: 3px solid #16a34a !important;",
      "  outline-offset: 2px !important;",
      "  border-radius: 6px !important;",
      "  animation: jaFilePulse 1s ease-in-out infinite !important;",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  /** Matching text for a file input: label/aria/id/name plus its accept types. */
  function fileSignal(input) {
    return JA.normalize(JA.getSignal(input) + " " + (input.accept || ""));
  }

  /** File inputs whose label/id/name matches resume/CV/attach keywords,
   *  excluding zones that belong to a different document (cover letter, …). */
  JA.resumeFileInputs = function () {
    return JA.queryAll('input[type="file"]').filter((input) => {
      const signal = fileSignal(input);
      if (JA.matchesKeywords(signal, JA.FILE_EXCLUDE_KEYWORDS)) return false;
      return JA.matchesKeywords(signal, JA.FILE_KEYWORDS);
    });
  };

  /** Decode a data: URL into raw bytes (works in the page's isolated world). */
  function dataUrlToBytes(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * The drop-oriented container a file input sits inside, if any.
   * Plain inputs (a bare <input type="file"> under its label) have none, and
   * for those a single `change` is all a real file pick ever produces.
   */
  function dropZoneFor(input) {
    return input.closest(
      '[class*="drop"], [class*="upload"], [class*="attach"], [class*="file"]'
    );
  }

  /**
   * Best-effort "the widget accepted it": does the surrounding zone now show
   * the file's name? Distinguishes a real acceptance from merely having written
   * bytes into input.files.
   */
  function zoneShowsFile(zone, name) {
    if (!zone) return false;
    const base = JA.normalize(String(name || "").replace(/\.[a-z0-9]+$/i, ""));
    if (!base) return false;
    return JA.normalize(zone.textContent || "").indexOf(base) !== -1;
  }

  /**
   * Attach the user's stored resume to every matching file input.
   *
   * We cannot read an arbitrary local path, but we CAN inject a file the user
   * explicitly handed to the extension: rebuild a File from the stored bytes,
   * wrap it in a DataTransfer, and assign it to input.files (the HTML `files`
   * attribute is writable — this is exactly how commercial autofillers do it).
   *
   * Safety rules:
   *   1. an input that ALREADY holds a file is left untouched — the user's own
   *      (possibly tailored) attachment is never clobbered;
   *   2. one signal only: the same `change` a real file pick fires. Firing the
   *      drag/drop sequence as well makes react-dropzone call onDrop twice
   *      (its hidden input's onChange AND its root drop handler);
   *   3. the drag/drop sequence is used only as a fallback for drop-only
   *      widgets that ignore the hidden input, and only when the zone shows no
   *      acknowledgement after `change`.
   */
  JA.attachResumeFile = async function (profile) {
    const record = profile && profile.resumeFile;
    const result = { attached: 0, kept: 0, zones: 0, acknowledged: 0 };
    if (!record || !record.dataUrl) return result;

    const inputs = JA.resumeFileInputs();
    if (inputs.length === 0) return result;

    let bytes;
    try {
      bytes = dataUrlToBytes(record.dataUrl);
    } catch (err) {
      return result; // Corrupt record — fall back to highlighting.
    }

    for (const input of inputs) {
      // 1. Preserve an attachment the user already placed here.
      if (input.files && input.files.length > 0) {
        result.kept++;
        continue;
      }

      const name = record.name || "resume.pdf";
      const zone = dropZoneFor(input);
      let transfer = null;

      try {
        const file = new File([bytes], name, {
          type: record.type || "application/pdf",
          lastModified: Date.now()
        });
        transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;

        // 2. One clear signal — what picking the file by hand produces.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        if (input.files && input.files.length > 0) result.attached++;
      } catch (err) {
        continue; // Unsupported in this context — leave it to the outline.
      }

      if (!zone) continue; // Plain input: `change` is the whole story.
      result.zones++;

      // 3. Escalate to drag/drop ONLY if the zone ignored the change event.
      await JA.sleep(140);
      if (!zoneShowsFile(zone, name)) {
        for (const type of ["dragenter", "dragover", "drop"]) {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "dataTransfer", { value: transfer });
          zone.dispatchEvent(event);
        }
        await JA.sleep(140);
      }

      // 4. Did the widget actually show the file, or did we only write bytes?
      if (zoneShowsFile(zone, name)) result.acknowledged++;
    }
    return result;
  };

  /**
   * Highlight every matching drop zone and return how many were flagged.
   * The real input is often visually hidden behind a styled wrapper, so we
   * highlight the nearest upload-ish container when there is one.
   */
  JA.highlightResumeFiles = function () {
    const inputs = JA.resumeFileInputs();
    if (inputs.length === 0) return 0;

    ensureStyle();
    let flagged = 0;
    for (const input of inputs) {
      // Nothing to flag on an upload that already has a file in it.
      if (input.files && input.files.length > 0) continue;

      const target =
        input.closest(
          'label, [class*="upload"], [class*="drop"], [class*="attach"], [class*="file"]'
        ) || input;
      target.setAttribute("data-ja-dropzone", "1");
      flagged++;

      // Clear the highlight as soon as the user actually attaches a file.
      input.addEventListener("change", () => {
        if (input.files && input.files.length > 0) {
          target.removeAttribute("data-ja-dropzone");
        }
      });
    }
    return flagged;
  };
})();
