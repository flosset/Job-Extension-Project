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
  Workday forms — and the toolbar badge reports the result. It records the same
  application-log row and "fields left for you" list the popup does, so the
  shortcut never loses your tracking.
- **Keeps an application log.** Pressing Fill on a posting records the company,
  role, URL and date **as \"in progress\"** — filling a form is not submitting it,
  and one click marks a row **applied** once you have. Opening the popup on a
  posting you have already logged **warns you before you fill**; a *different*
  posting that merely shares the company and role is a **possible** repeat, never
  a certainty. Postings are told apart by their URL including any job-id
  parameter (`?gh_jid=…`, `?jk=…`), with only tracking parameters dropped, so two
  "Software Engineer" roles at one company stay two applications — a
  100-application search never repeats work.
  When the page does not say which job it is, the popup **asks** — "Which job is
  this?" — rather than filing a nameless row; whatever the page did give is
  prefilled, and every row's name stays editable afterwards. A status per row
  (saved / in progress / applied / screen / interview / offer / rejected /
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
- **Remembers widgets you fill by hand.** A repeated group nobody has taught the
  extension — a *References* block, an emergency contact, a bespoke education
  widget — is learned from the way you fill it, so next time it is filled for you
  **before** the ordinary name/email matching runs. Nothing is saved without a
  click, and the profile page lists what it knows (with when each was last used)
  so a stale one can be deleted.

## How the job name is detected

The **date is always exact** — it is when you pressed Fill. The **name** comes
from whatever the page is willing to say, in this order:

1. the `schema.org/JobPosting` JSON-LD block (`hiringOrganization` + `title`) —
   the only fully reliable source;
2. `og:site_name`, the employer's **logo alt text** ("Acme logo" → "Acme"), or a
   `company` / `employer` heading;
3. the page title, split as "Role - Company" or "Role at Company";
4. an `<h1>` for the role;
5. **the URL itself**, as a last resort — see below.

An ATS vendor's own name is always skipped rather than used ("Greenhouse",
"Lever", …), and a trailing site word is stripped ("NVIDIA Careers" → "NVIDIA"),
because a wrong company would fire the duplicate warning on every posting from
that board.

### Which boards name the employer in the URL

Plenty of boards put the employer's own identifier in the URL, which is a good
last resort when the page itself says nothing:

| Board | Where the name lives | Example |
|---|---|---|
| Workday | tenant subdomain | `nvidia.wd5.myworkdayjobs.com` → **Nvidia** |
| Taleo | tenant subdomain | `acme.taleo.net/…` → **Acme** |
| iCIMS | tenant subdomain | `careers-acme.icims.com/…` → **Acme** |
| BambooHR | tenant subdomain | `acme.bamboohr.com/careers/42` → **Acme** |
| Greenhouse | first path segment | `job-boards.greenhouse.io/acme/jobs/4` → **Acme** |
| Lever | first path segment | `jobs.lever.co/globex/abc` → **Globex** |
| Workable | first path segment | `apply.workable.com/initech/j/…` → **Initech** |
| SmartRecruiters | first path segment | `jobs.smartrecruiters.com/Hooli/…` → **Hooli** |
| Ashby / Jobvite / Teamtailor | first path segment | `jobs.ashbyhq.com/dunder-mifflin/…` → **Dunder Mifflin** |

Structure words (`embed`, `jobs`, `apply`, `careers`, `v1`, …) and anything
containing a digit (`career5`, `wd5`) are rejected, so a URL can never produce a
bogus employer. A page that *does* name itself always wins over its URL.

When nothing at all can be found, the row shows the site host, and the popup
**asks**:

> **Which job is this?**
> This page didn't give us the company and the role. Add them and they go into
> your application log.
> `[ Company ] [ Role ]`  **Save to log** · *Not now*

It asks only when something is missing — if the company was found it asks for the
role alone — prefills whatever was read, and writes into the row that fill
already created, never a second one. Because the popup closes on any click, the
question is remembered per tab and comes back until it is answered; `Not now`
silences it and leaves the row nameless (nameable later on the options page).
A job the page *did* name is never asked about.

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
profile, the named profiles, the learned candidates, the remembered field lists,
the widgets you taught me (which hold other people's details) and the application
log in one go. Nothing is ever sent anywhere, and the tracker
only records a page you actually pressed Fill on.


`Back up everything` writes one JSON file holding your profile (including the
resume), your **named profiles**, the **widgets** you taught me, your
**application log** and the **answers learned from typing**; `Restore everything`
puts them all back — on the same machines or a new one. That file contains
personal details, so keep it somewhere safe. `Delete all` wipes everything from
the browser.

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
content/widget-learn.js  learns a widget definition from watching you fill one
content/radios.js      Yes/No radio groups
content/files.js       resume auto-attach
content/phone.js       split country-code + number pairs
content/page-info.js   what job this page is for (company + role)
content/learn.js       watches the fields left for you, records candidates
content/autofill.js    orchestrator: reads the profile, fills, reports
```

`popup.html` and `options.html` are the two screens; both load the same UI
scripts, in this order (top-level bindings in classic scripts are visible to
later ones, so order matters):

```
shared.js               the shared list + keys + the dedupe rule
ui/core.js              constants, the null-safe DOM helpers, setStatus
ui/profile-form.js      load/save the profile form, dirty tracking, auto-save
ui/profile-sections.js  snippet + Work Experience / Education editor rows
ui/resume.js            the resume file: pick, store, clear
ui/backup.js            back up everything / restore / Delete all
ui/learned.js           the review step for answers learned from typing
ui/fill-aggregate.js    the per-frame completion model
ui/fill-run.js          injection into every frame + the broad-access grant
ui/unfilled-list.js     "fields left for you" + click-to-highlight
ui/run-history.js       the remembered run per tab, duplicate warning
ui/profiles.js          named profiles (the active one is mirrored into jobProfile)
ui/applications.js      the application log: record, edit, render, CSV
ui/job-ask.js           the "which job is this?" question
ui/cover-letter.js      templates, placeholders, copy / type into the form
ui/widgets.js           "remember this widget": offers + the saved list
ui/editor.js            bootstrap: wires whichever controls this page owns
```

`ui/profile-form.js`, `ui/profile-sections.js`, `ui/resume.js` and `ui/backup.js`
were one file (`ui/storage.js`) and share one page scope, so they call each
other directly. `ui/fill-aggregate.js`, `ui/fill-run.js`, `ui/unfilled-list.js`
and `ui/run-history.js` were one file (`ui/fill-runner.js`) the same way.

The UI script list is read **from `popup.html`** by the test harness, so a new
`ui/*.js` file cannot be forgotten there either. A test also asserts the popup
and the options page load the **same scripts in the same order**.

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

### Teaching it a widget instead

When a repeated group has no definition, you can teach it rather than wait for
one. Fill the widget by hand once and the extension infers a definition from it:

```
References · 2 blocks · 3 fields            boards.greenhouse.io
                              [ Save ]  [ Not now ]
```

What it learns is the same shape as a hand-written section — `anchor` (how to
find the block), `confirm` (proof it is the group), `fields` (slug → label
keywords), `addButton`, and one row of **values** per block. So replay is the
same, already-guarded engine: it will not grow a widget it cannot verify, and a
definition whose labels no longer match does **nothing at all** rather than
clicking at random.

It only offers a widget when it is *sure*: a repeated group, ≥2 fields **you**
typed into (a field the fill wrote never counts), and ≥2 of those with readable
labels. A widget whose fields have no labels is refused and the reason is shown —
a definition keyed by position or a React id would rot on the next deploy.

A long free-text answer is refused too. A definition belongs to the site's
**host**, and boards like Greenhouse and Lever share one host across every
company, so a paragraph written for one application would be pasted verbatim into
the next company's form. Paragraphs belong in the answer bank, which asks before
it reuses them.

Each field's value comes from one of exactly two places:

| Source | Example | On replay |
|---|---|---|
| **Profile key** — only when the value you typed *is* the stored value | School → `profile.school` | resolved fresh, so it tracks profile edits |
| **Literal** — captured as typed | a referee's name or email | kept as stored, since the profile has nowhere for it |

Candidates live under their own storage key and only become real on **Save**, so
a candidate can never fill a live form. Saved widgets appear on the profile page
with their host, field count, times used and when last used — delete any that has
gone stale. A learned widget is applied **first**, before the page-wide passes,
and claims its fields so nothing downstream can overwrite them.

## Tests

The suite runs in Node with jsdom, loading the **real** source files and the
**real** HTML pages with `chrome.*` stubbed. It lives in `tests/`.

**Setup (once):**

```
cd tests
npm install
```

**Standard command — every suite in parallel (Windows/macOS/Linux):**

```
cd tests
npm test
```

Each suite is an independent process and is judged by its own printed verdict
(plus a check that it printed *a* verdict at all, so a crash can't pass).
The runner also requires a zero exit code. Paths are relative to the checkout,
not a developer's drive. The PowerShell runner remains available on Windows.

Safety regressions include delayed/in-flight autosaves during Delete all,
button-driven edits and completed resume reads, sparse profile switching,
shadow-root labels/location, and shortcut reports from embedded frames.
History deletion requires temporary approval from a confirmed popup run;
ordinary shortcut fills never use the saved preference as deletion authority.
Backup sections explicitly present but empty are cleared on restore; absent
sections in older/profile-only files remain untouched. CSV cells that could be
spreadsheet formulas are prefixed with an apostrophe.

**Or a single suite** (each file is `<area>.test.js`):

```
cd tests
node fill-basic.test.js              # main fill pass
node answer-bank-unfilled.test.js    # answer bank + unfilled report
node work-experience-sections.test.js # Work Experience sections
node education-sections.test.js      # Education sections
node negation-safe-matching.test.js  # negation-safe answer matching
node run-completion.test.js          # run-completion model
node file-attach-safety.test.js      # resume attach safety
node repeatable-safety.test.js       # destructive-trim gating + dialog scoping
node data-ownership.test.js          # export / import / delete-all
node split-ui.test.js                # popup vs options split
node unfilled-review.test.js         # "fields left for you"
node answer-bank-scope.test.js       # answer-bank scope, loose selectors, full name
node optional-host-access.test.js    # optional broad host access
node learn-from-typing.test.js       # learn-from-typing + the four dedupe rules
node shortcut-badge.test.js          # Alt+Shift+F, the badge, cross-context drift guards
node unfilled-survives.test.js       # "fields left for you" survives the popup closing
node application-tracker.test.js     # the application tracker: page info, logging, duplicate warning
node named-profiles.test.js          # multiple profiles (and the v1 migration)
node cover-letter.test.js            # cover-letter templates and placeholders
node split-phone.test.js             # split phone fields (country code + number)
node shadow-dom.test.js              # open Shadow DOM traversal
node greenhouse-education.test.js    # Greenhouse's react-select Education block (reuse, not clones)
node remember-widget.test.js         # "remember this widget" learn/refuse rules
node editor-privacy.test.js          # editor data ownership + privacy wipe barrier
node matcher.test.js                 # field-matcher option table
```

The runner discovers every `*.test.js` in `tests/`; helper files
(`_popup-source.js`, `run-all.js`, `bench.js`, `probe*.js`, `proof-*.js`) are
not suites and are ignored.

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
- **Live ATS flows are not yet verified in a real browser.** The jsdom suites
  cover the DOM shapes we know, but representative Workday, Greenhouse, Lever and
  Ashby applications should be opened (without submitting) in Chrome to confirm
  the reads and the fills on the live DOM. This is the highest-value open task;
  it is manual/QA work, not something the unit suites can stand in for.
- **Learned widgets** handle repeated groups with readable labels. A widget whose
  fields have no labels is refused (nothing is guessed), and widgets that are not
  repeated groups at all — wizards, calendar-popup date pickers, drag-and-drop —
  cannot be taught this way. A learned definition lives per host, so a widget
  that only appears on one company's board is learned once for that board.
