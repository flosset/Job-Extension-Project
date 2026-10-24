# Private Job Autofill

A privacy-first, zero-idle Chrome (MV3) extension that fills job-application
forms from a profile stored **only in your browser**. No AI, no network calls,
no telemetry, no accounts.

See [Architecture](docs/architecture.md) for component diagrams, fill sequences, and storage/data flows.

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

## Teach a field or section

Open the extension on an application form and choose **Teach a field / section**.
Click fields to include or exclude them, or focus a field and press **F8**.
**Add nearby section** proposes neighboring fields; use **Remove** to adjust the
selection. A section does not need repeated rows to be taught.

Review each field's value source: keep a literal answer, or explicitly select a
profile field whose current value is previewed. Reuse defaults to **only this
application page**. Whole-site reuse is optional and can cover other employers
on the same job board. Nothing is saved until **Save taught fields** is pressed;
Cancel or Escape discards the selection. Teaching itself does not fill the form.

Taught mappings appear in the profile editor's saved widgets and are included in
backup, restore, and deletion. On Fill, labels, section context, and control types
must match uniquely before replay starts. Changed or ambiguous mappings are
skipped and reported; answers already on the page are preserved. This route
supports labeled text inputs, textareas, native single selects, and supported
single-value React dropdowns. Files, action buttons, consent, demographic and
identity fields are excluded. Literal answers are limited to one line and 500
characters; use the answer bank for longer text.

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
runs a fill when you press **Fill Application** or **Alt+Shift+F**. The field
list can highlight a field on a tab you just filled. **Teach a field / section**
opens a selector only when requested and saves only the fields you confirm.

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

## License and contributions

This project is free software licensed under the
[GNU General Public License, version 3 only (GPL-3.0-only)](LICENSE.md).
You may use, modify, and redistribute it, including commercially, under that license.
It is provided without any warranty; see the license for details.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull requests, testing, and packaging.
Bug reports and sanitized form reproductions are welcome.

## Release package

Run `./scripts/package.ps1` from PowerShell in the repository root. It creates
`dist/private-job-autofill-<version>.zip`, using the version in `manifest.json`.
The package includes runtime files and the license, excluding tests and local settings.
Extract a release ZIP and follow the unpacked installation instructions below.

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

Plain ES2020+ scripts, no build step. Three groups of files, each in its own
folder so the tree itself says what lives where:

```
shared/                  genuinely cross-context: keys, caps, validation, rules
  index.js               storage keys, caps, the injected-file list, text rules
  phone.js               splitting a stored number into country + national parts
  learned.js             coercion for the "answers you typed" candidates
  applications.js        posting identity, match strength, the ONE logApplication
  widgets.js             coercion for remembered-widget definitions
  profiles.js            coercion for the named profiles (incl. the v1 adoption)

content/                 what runs inside the page, in the injected order
  autofill.js            ORCHESTRATOR ONLY: the pass order and the result message
  matching/              deciding WHAT a field is
    field-map.js         pure data: selector/keyword/synonym tables
    field-signals.js     label/aria/placeholder text and keyword matching
    option-match.js      synonym- and polarity-aware option/value matching
    field-matcher.js     choosing WHICH field answers a key
    unfilled-report.js   what is left for the user, and the page diagnostics
  controls/              reading and writing ONE control
    shadow-dom.js        traversal across open shadow roots (queryAll/fieldPool)
    dom-state.js         fillable / empty / filled / visible / required
    dom-events.js        the events framework-driven portals listen for
    dom-inject.js        native-setter writes, real typing, select/checkbox
    locate.js            tagging a field so the popup can point back at it
    field-fill.js        fill the first field matching a keyword list
    combobox.js          react-select driver (open → read → commit → close)
    dates.js             month/year pairs + date value formatting
    radios.js            Yes/No radio groups
    phone.js             split country-code + number pairs
    files.js             resume auto-attach
  sections/              repeated groups and taught-widget replay
    repeatable.js        Work Experience / Education sections
    recipe-replay.js     replay a widget definition the user accepted
  learning/              capturing what you type
    answers.js           watches the fields left for you, records candidates
    widget-shape.js      the shape of a repeated group (pure DOM reading)
    widgets.js           infers a widget definition from watching you fill one
  page/                  page-info.js — what job this page is for

ui/                      the popup and options screens, in the load order
  core.js                constants, the null-safe DOM helpers, setStatus
  profile/               form.js, sections.js, resume.js, backup.js,
                         profiles.js, actions.js
  fill/                  aggregate.js, run.js, unfilled.js, history.js
  tracker/               applications.js, job-ask.js
  cover-letter/          letter.js, templates.js
  learning/              learned.js, widgets.js
  app.js                 bootstrap: wires whichever controls this page owns
```

`popup.html` and `options.html` load the same scripts in the same order
(top-level bindings in classic scripts are visible to later ones, so order
matters): `shared/*` first, then `ui/`, with `ui/app.js` last because it wires
the controls once everything it wires is defined.

The injected list lives in `shared/index.js` as
`JOB_AUTOFILL_SHARED.contentScripts`. Because injected files cannot `import`,
that one list is what the worker's `importScripts`, both pages, and the test
harness all read — and tests assert the worker, the pages and the list agree, so
they cannot drift.

`background.js` is the MV3 service worker: the Alt+Shift+F command and the
toolbar badge. It renders the badge from one place, so a fresh fill result and
the "N answers to review" count can never fight over it.

Every element lookup is null-safe, so a page only needs the controls it uses —
the compact popup and the full editor share all of this code.

### Adding label synonyms

Most support for a new portal is **data, not code**: add the wording the site
uses to `JA.KEYWORDS` or a section's `fields` in `content/matching/field-map.js`.
Matching is label-driven, so no per-domain adapters are needed.

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

The suites are grouped by area, mirroring the source tree:

```
tests/
  _popup-source.js       the ONE loader: script lists + APP_DIR
  run-all.js             parallel runner (discovers *.test.js at any depth)
  run-all.ps1            the same, for Windows PowerShell
  fill/                  the run end to end      (7)  fill-basic, run-completion,
                         unfilled-review, unfilled-survives, answer-bank-unfilled,
                         optional-host-access, shortcut-badge
  matching/              what a field is         (7)  matcher, negation-safe-matching,
                         answer-bank-scope, address-dropdowns, reactive-dropdowns,
                         profile-fields-dates, shadow-dom
  controls/              one control at a time   (6)  combobox-enter-commit,
                         combobox-multiselect-close, split-phone, file-attach-safety,
                         resume-attach, radios-files-snippets
  sections/              repeated groups         (4)  work-experience-sections,
                         education-sections, repeatable-safety, greenhouse-education
  learning/              capture + replay        (2)  learn-from-typing, remember-widget
  ui/                    the two screens         (6)  split-ui, data-ownership,
                         editor-privacy, named-profiles, cover-letter, application-tracker
  tools/                 dev tools, NOT suites        bench.js, probe*.js,
                         proof-feature3.js, bench400.txt
```

**Or a single suite** (a file is `<area>/<what-it-covers>.test.js`):

```
cd tests
node fill/fill-basic.test.js                  # main fill pass
node fill/run-completion.test.js              # run-completion model
node fill/unfilled-review.test.js             # "fields left for you"
node fill/unfilled-survives.test.js           # ...survives the popup closing
node fill/answer-bank-unfilled.test.js        # answer bank + unfilled report
node fill/optional-host-access.test.js        # optional broad host access
node fill/shortcut-badge.test.js              # Alt+Shift+F, the badge, drift guards
node matching/matcher.test.js                 # field-matcher option table
node matching/negation-safe-matching.test.js  # negation-safe answer matching
node matching/answer-bank-scope.test.js       # answer-bank scope, loose selectors
node matching/address-dropdowns.test.js       # country / state / location widgets
node matching/reactive-dropdowns.test.js      # react-select from the answer bank
node matching/profile-fields-dates.test.js    # standard fields + date handling
node matching/shadow-dom.test.js              # open Shadow DOM traversal
node controls/combobox-enter-commit.test.js   # a widget that only commits on Enter
node controls/combobox-multiselect-close.test.js # a menu that only closes on toggle
node controls/split-phone.test.js             # country code + number pair
node controls/file-attach-safety.test.js      # resume attach safety
node controls/resume-attach.test.js           # resume auto-attach
node controls/radios-files-snippets.test.js   # radios, drop zones, snippets
node sections/work-experience-sections.test.js # Work Experience sections
node sections/education-sections.test.js      # Education sections
node sections/repeatable-safety.test.js       # destructive-trim gating + dialogs
node sections/greenhouse-education.test.js    # Greenhouse's react-select Education block
node learning/learn-from-typing.test.js       # learn-from-typing + dedupe rules
node learning/remember-widget.test.js         # "remember this widget" learn/refuse
node ui/split-ui.test.js                      # popup vs options split
node ui/data-ownership.test.js                # export / import / delete-all
node ui/editor-privacy.test.js                # editor ownership + privacy wipe
node ui/named-profiles.test.js                # multiple profiles (and v1 migration)
node ui/cover-letter.test.js                  # cover-letter templates + placeholders
node ui/application-tracker.test.js           # page info, logging, duplicate warning
```

The runner discovers every `*.test.js` under `tests/` at any depth; `tools/` and
the helper files (`_popup-source.js`, `run-all.js`) are not suites and are
ignored.

Every suite loads its content scripts from the **real** list in
`shared/index.js` (via `tests/_popup-source.js`), so adding a content script can
never leave a suite quietly testing a stale subset. The harness also checks, in
both directions, that the `shared/` files on disk are exactly the ones the
injected list names.

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
