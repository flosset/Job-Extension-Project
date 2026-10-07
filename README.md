# Private Job Autofill

A privacy-first, zero-idle Chrome (MV3) extension that fills job-application
forms from a profile stored **only in your browser**. No AI, no network calls,
no telemetry, no accounts.

## What it does

- Fills the standard fields — name, contact, links, address, work
  authorisation, self-identification, salary, availability.
- Handles the awkward widgets: native `<select>`, `react-select` comboboxes
  (including **searchable** ones that render no options until you type, as
  Greenhouse's School picker does), month/year date pairs, `input[type=date]`,
  contenteditable bios.
- Repeats **Work Experience** and **Education** sections (overwrite, add, and —
  only if you opt in — remove leftover blocks).
- **Auto-attaches your resume** and warns you if the site never confirmed it.
- Answers free-text questions from an **answer bank** you write yourself.
- **Learns from what you type.** Any field the fill left for you is watched; the
  answer you type is offered back as a new bank entry — never saved without a
  click, and never twice for the same question.
- Tells you exactly which fields are **left for you**, required first, and lets
  you click one to be shown where it is on the page. The list is remembered
  **per tab**, so it is still there when you reopen the popup to work through
  those fields by hand.
- **Alt+Shift+F** fills the page without opening the popup — handy on multi-page
  Workday forms — and the toolbar badge reports the result.
- **Keeps an application log.** Pressing Fill on a posting records the company,
  role, URL and date, and a page you have applied to before is **warned about
  before you fill it again** — so a 100-application search never repeats work.
  Each row's name is **editable in place**, because a page does not always say
  which job it is: whatever the page gave is filled in, and the rest is one click
  away. A status per row (applied / screen / interview / offer / rejected /
  withdrawn) and a CSV export live on the options page.
- **Multiple profiles.** Keep a Frontend resume and a Full-stack one (or a US and
  a UK address) and pick one per application from the popup.
- **Cover-letter templates** with `{company}` / `{role}` / `{firstName}` /
  `{fullName}` / `{email}` / `{phone}` / `{city}` / `{today}` placeholders, filled
  in from the job actually on the page. Copy the letter, or have it typed into
  the form.
- **Split phone fields** (a separate country code + number, as Taleo and Workday
  render them) are filled as a pair.
- Reaches fields inside **open Shadow DOM** (web-component widgets).

## How the job name is detected

The **date is always exact** — it is when you pressed Fill. The **name** comes
from whatever the page is willing to say, in this order:

1. the `schema.org/JobPosting` JSON-LD block (`hiringOrganization` + `title`) —
   what Greenhouse, Lever, Ashby, Workable and most boards publish, and the only
   fully reliable source;
2. `og:site_name`, the employer's **logo alt text** ("Acme logo" → "Acme"), or a
   `company` / `employer` heading;
3. the page title, split as "Role - Company" or "Role at Company" (a board's own
   name is never taken as the employer);
4. an `<h1>` for the role.

An ATS vendor's own name is always skipped rather than used: a wrong company
would fire the duplicate warning on every posting from that board.

When the form sits on a *different* page than the posting — a bare `/apply` link
with no metadata — there may be nothing to read. The row then shows the site host
instead of a name, and the name is one click away, because **both fields are
editable inline**.

## Privacy

Everything lives in `chrome.storage.local`. The extension makes no outbound
requests and does nothing on a page you did not ask for: the service worker only
runs a fill when you press **Fill Application**, press **Alt+Shift+F**, or the
field list sends a single "scroll to this" message for a tab you just filled.

The learned answers below the answer bank are **candidates**, not settings. They
sit in their own storage key, are shown with a Save button each, and only become
bank entries when you click.

The last fill's "fields left for you" list is remembered per tab (at most five
tabs, six hours) so it survives closing the popup. It holds field labels only.

The **application log** and the **named profiles** are user data too: the log
holds the company, role, URL and date of each application, and each profile holds
its own copy of everything, including its resume. `Delete all` removes the
profile, the named profiles, the learned candidates, the remembered field lists
and the application log in one go. Nothing is ever sent anywhere, and the tracker
only records a page you actually pressed Fill on.


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
| `popup.html` | Fill, pick a profile, copy the cover letter, see what's left. Deliberately tiny (340 px). |
| `options.html` | The full width editor: profile, named profiles, cover-letter templates, the application log. **Saves automatically** as you type. |

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
5. **Never bank the same question twice.** A question the answer bank already
   answers is never learned again, whatever the new answer is, because two
   entries asking one question would compete for the same field and which one
   wins would be arbitrary.
6. **Never guess an ambiguous answer.** If the same question shows up twice with
   different answers, nothing is learned from it and the user is told — rather
   than silently remembering the wrong one.
7. **Never mis-report.** Results wait for every frame to answer, and the popup
   says so when one didn't.
8. **Never mutate a repeatable section it cannot verify.** "Add another" is only
   clicked when the blocks already on the page are ones it can identify *and*
   fill, and never when it can see no block at all — a click whose result cannot
   be checked is a change we refuse to make. A section it could not address is
   reported instead.
9. **Never trust a label it cannot tie to the control.** A nearby label is
   credited to a field only when its `for` points at that control, at a wrapper
   that contains it, at nothing (the input it named was replaced, as react-select
   does), or when the container holds exactly one field — so a neighbouring row's
   label can never be borrowed.

## Architecture

Plain ES2020+ scripts, no build step. The injected files share one namespace
(`window.__JobAutofill`) and must load in this order:

```
shared.js              the ONE list of injected files + storage keys (also
                       imported by the service worker, loaded by both pages)
content/field-map.js   pure data: selector/keyword/synonym tables
content/dom-utils.js   text + DOM helpers, the polarity-safe matcher
content/combobox.js    react-select driver (open → read → commit → close)
content/fill.js        generic per-field dispatch (any widget, any scope)
content/dates.js       month/year select pairs
content/repeatable.js  Work Experience / Education sections
content/radios.js      Yes/No radio groups
content/files.js       resume auto-attach
content/phone.js       split country-code + number pairs
content/page-info.js   what job this page is for (company + role)
content/learn.js       watches the fields left for you, records candidates
content/autofill.js    orchestrator: reads the profile, fills, reports
```

`popup.html` and `options.html` are the two screens; both load the same nine UI
scripts, in this order (top-level bindings in classic scripts are visible to
later ones, so order matters):

```
shared.js            the shared list + keys + the dedupe rule
ui/core.js           constants and the null-safe DOM helpers
ui/storage.js        profile load/save, repeatable cards, resume, export/import
ui/learned.js        the review step for answers learned from typing
ui/fill-runner.js    injection into every frame, result aggregation, status
ui/profiles.js       named profiles (the active one is mirrored into jobProfile)
ui/tracker.js        the application log: record, warn, status, CSV
ui/cover-letter.js   templates, placeholders, copy / type into the form
ui/editor.js         bootstrap: wires whichever controls this page owns
```

The UI script list is read **from `popup.html`** by the test harness, so a new
`ui/*.js` file cannot be forgotten there either.

`background.js` is the MV3 service worker: the Alt+Shift+F command and the
toolbar badge. It renders the badge from one place, so a fresh fill result and
the "N answers to review" count can never fight over it.

Every element lookup is null-safe, so a page only needs the controls it uses —
the compact popup and the full editor share all of this code.

Injected files cannot `import`, so `shared.js` holds the list as
`JOB_AUTOFILL_SHARED.contentScripts` — the popup and the worker both read it from
there, and a test asserts the two can never disagree.

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
node e2e21.js     # optional broad host access
node e2e22.js     # learn-from-typing + the four dedupe rules
node e2e23.js     # Alt+Shift+F, the badge, cross-context drift guards
node e2e24.js     # "fields left for you" survives the popup closing
node e2e25.js     # the application tracker: page info, logging, duplicate warning
node e2e26.js     # multiple profiles (and the v1 migration)
node e2e27.js     # cover-letter templates and placeholders
node e2e28.js     # split phone fields (country code + number)
node e2e29.js     # open Shadow DOM traversal
node e2e30.js     # Greenhouse's react-select Education block (reuse, not clones)
node matcher-test.js
```

Every suite loads its content scripts from the **real** list in `shared.js` (via
`tests/_popup-source.js`), so adding a content script can never leave a suite
quietly testing a stale subset.

`test-*.html` are manual fixtures for loading in a browser; they are not part of
the published package.

## Known gaps

- **Closed** shadow roots are unreachable by design (no API exists), and a page
  that reports nothing about its job will log its URL rather than a guessed
  company — a wrong company would fire the duplicate warning on every posting
  from that board.
- **Split phone fields** are only paired when both halves exist *and* sit within
  three levels of a shared container; otherwise the single phone field keeps the
  whole number, exactly as before.
- **Calendar-popup date pickers** (react-datepicker-style) are not driven; a
  plain `input[type=date]` or a month/year pair is.
- Workday's live DOM has not been verified against a real application locally.
