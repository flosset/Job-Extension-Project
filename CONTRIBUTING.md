# Contributing

Bug reports, sanitized form reproductions, documentation, and pull requests are welcome.
This project is source available under the [PolyForm Noncommercial license](LICENSE).
Review the license before using or contributing code.

## Local setup

1. Clone the repository.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the repository root. Reload the extension after editing its files.
4. Use fake profile data and the root `test-*.html` fixtures for manual checks.

There is no build step. Install Node.js 24 and run the automated suites:

```sh
cd tests
npm ci
npm test
```

## Making a change

- Fork the repository, create a branch, and open a pull request against the default branch.
- Describe the problem, resulting behavior, and how you verified the change.
- Keep changes focused. Follow the existing plain JavaScript structure; see [architecture](docs/architecture.md).
- Label vocabulary belongs in `content/matching/field-map.js` where possible.
- For behavior changes, add a focused regression case to the relevant existing test suite.
- Preserve local storage, user-triggered filling, and explicit consent for destructive changes.
- Never add real resumes, profile backups, credentials, or other people's contact details to reports or fixtures.

For a form bug, include the browser version, ATS name, expected and actual behavior,
and a minimal sanitized HTML example when possible. Remove personal data and tokens
from URLs, screenshots, and page HTML. Do not submit real applications as part of testing.

Live checks on Workday, Greenhouse, Lever, and Ashby are especially useful. Report
what you checked and any gaps; automated DOM tests do not verify live ATS behavior.

## Packaging

From the repository root, run this in PowerShell (PowerShell 7 on macOS/Linux):

```powershell
./scripts/package.ps1
```

On Windows, if unsigned scripts are blocked, use this command for this invocation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

The ZIP in `dist/` uses the manifest version and contains runtime files plus the
license. Extract it and load the extracted folder in Chrome for a release smoke test.
When adding other runtime assets, update the packaging allowlist.

Commercial licensing arrangements for outside contributions need a separate agreement
with the relevant copyright holders. Submitting a pull request does not transfer copyright.
