# Private Job Autofill

A privacy-first, zero-idle Chrome (MV3) extension that fills job-application
forms from a profile stored **only in your browser**. No AI, no network calls,
no telemetry, no accounts.

## What it does

- Fills the standard fields — name, contact, links, address, work
  authorisation, self-identification, salary, availability.
- Handles the awkward widgets: native `<select>`, `react-select` comboboxes,
  month/year date pairs, `input[type=date]`, contenteditable bios.
- Repeats **Work Experience** and **Education** sections (overwrite, add, and —
  only if you opt in — remove leftover blocks).
- **Auto-attaches your resume** and warns you if the site never confirmed it.
- Answers free-text questions from an **answer bank** you write yourself.
- Tells you exactly which fields are **left for you**, required first, and lets
  you click one to be shown where it is on the page.

## Privacy

Everything lives in `chrome.storage.local`. The extension makes no outbound
requests and has no background service worker doing anything on its own. It
only touches a page when you press **Fill Application** (or the field list sends
a single "scroll to this" message for a tab you just filled).

`Export data` writes your profile (including the resume) to a JSON file — that
file contains personal details, so keep it somewhere safe. `Delete all` wipes
everything from the browser.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → pick this folder.
3. Click the toolbar icon → **Edit full profile…** and fill your profile in.
4. On any application form, click **Fill Application**.

## The two screens

| Screen | Purpose |
|---|---|
| `popup.html` | Fill, and see what's left. Deliberately tiny (340 px). |
| `options.html` | The full width editor. **Saves automatically** as you type. |

A page may only write the parts of the profile it actually shows, so saving from
one screen can never wipe a field owned by the other.

## Guarantees the code is built around

These are the things the extension deliberately refuses to do:

1. **Never answer the opposite.** A stored "Yes" can't land on an option reading
   *"I am not authorized to work"*. Answers are polarity-checked; when the form
   is ambiguous the field is left **blank** rather than guessed.
2. **Never fill from stale data.** The editor auto-saves and flushes the moment
   its tab is hidden.
3. **Never clobber your upload.** An attachment you already added is left alone,
   and exactly one upload signal is fired (so dropzone-style widgets don't
   register the file twice).
4. **Never delete without being asked.** Surplus history blocks are counted and
   reported, but only removed when you tick the destructive option — and only
   if a confirmation dialog that genuinely mentions deleting appears.
5. **Never mis-report.** Results wait for every frame to answer, and the popup
   says so when one didn't.

## Architecture

Plain ES2020+ scripts, no build step. The injected files share one namespace
(`window.__JobAutofill`) and must load in this order:

```
content/field-map.js   pure data: selector/keyword/synonym tables
content/dom-utils.js   text + DOM helpers, the polarity-safe matcher
content/combobox.js    react-select driver (open → read → commit → close)
content/fill.js        generic per-field dispatch (any widget, any scope)
content/dates.js       month/year select pairs
content/repeatable.js  Work Experience / Education sections
content/radios.js      Yes/No radio groups
content/files.js       resume auto-attach
content/autofill.js    orchestrator: reads the profile, fills, reports
```

`popup.html` and `options.html` are the two screens; both load the same four UI
scripts, in this order (top-level bindings in classic scripts are visible to
later ones, so order matters):

```
ui/core.js         shared constants + the null-safe DOM helpers
ui/storage.js      profile load/save, repeatable cards, resume, export/import
ui/fill-runner.js  injection into every frame, result aggregation, status
ui/editor.js       bootstrap: wires whichever controls this page owns
```

Every element lookup is null-safe, so a page only needs the controls it uses —
the compact popup and the full editor share all of this code.

Injected files cannot `import`, so `ui/core.js` lists them in
`CONTENT_SCRIPTS` and `ui/fill-runner.js` hands that list to
`chrome.scripting.executeScript`, which evaluates them in order.

### Adding label synonyms

Most support for a new portal is **data, not code**: add the wording the site
uses to `JA.KEYWORDS` or a section's `fields` in `content/field-map.js`. Matching
is label-driven, so no per-domain adapters are needed.

## Tests

The suite runs in Node with jsdom, loading the **real** source files and the
**real** HTML pages with `chrome.*` stubbed. It lives in `tests/`.

**Setup (once):**

```
cd tests
npm install
```

**Fastest — every suite in parallel (~9 s):**

```
powershell -NoProfile -File tests\run-all.ps1
```

Each suite is an independent process and is judged by its own printed verdict
(plus a check that it printed *a* verdict at all, so a crash can't pass).

**Or a single suite:**

```
cd tests
node e2e2.js      # main fill pass
node e2e7.js      # answer bank + unfilled report
node e2e11.js     # Work Experience sections
node e2e12.js     # Education sections
node e2e13.js     # negation-safe answer matching
node e2e14.js     # run-completion model
node e2e15.js     # resume attach safety
node e2e16.js     # destructive-trim gating + dialog scoping
node e2e17.js     # export / import / delete-all
node e2e18.js     # popup vs options split
node e2e19.js     # "fields left for you"
node e2e20.js     # answer-bank scope, loose selectors, full name
node matcher-test.js
```

`test-*.html` are manual fixtures for loading in a browser; they are not part of
the published package.

## Known gaps

- **Shadow DOM** (Lit / Stencil / web-component portals) is not traversed yet.
- **Calendar-popup date pickers** (react-datepicker-style) are not driven; a
  plain `input[type=date]` or a month/year pair is.
- **Closed** shadow roots are unreachable by design (no API exists).
- Workday's live DOM has not been verified against a real application locally.
