# Contributing

Bug reports, sanitized form reproductions, documentation, and pull requests are welcome.
This project is source available under the [PolyForm Noncommercial license](LICENSE).
Review the license before using or contributing code.

## Ownership and commercial licensing

Contributors keep ownership of their contributions and give the project owner
permission to include them in both the free noncommercial version and separately
licensed commercial versions. Submitting a contribution does not transfer copyright.

### Contribution terms

These terms apply to code, documentation, and other original material you
intentionally submit for inclusion in Private Job Autofill. The project owner is
the person or entity operating the GitHub account `flosset` for this repository.

1. **Ownership.** You retain copyright in your contributions and may continue to
   use and license your own work elsewhere.
2. **Permission.** You grant the project owner a worldwide, nonexclusive,
   perpetual, irrevocable, royalty-free copyright license to use, copy, modify,
   display, distribute, and sublicense your contributions and modified versions
   as part of this project. This includes releasing them under the project's
   noncommercial license and under separate commercial or proprietary licenses,
   and charging for those licenses without owing you royalties. This permission
   does not transfer ownership of your contributions.
3. **Authority and third-party material.** You confirm that you own the rights
   needed to grant this permission or have authorization from the rights holder,
   including your employer where applicable. Identify any third-party material
   and its license in your submission. These terms do not override third-party
   rights or license restrictions.
4. **Project rights.** This agreement covers your contributions only. It does
   not give you commercial rights to the rest of the project or grant rights to
   anyone's trademarks.
5. **Support and warranties.** You do not promise ongoing support. To the extent
   permitted by law, your contributions are provided as is, without warranties,
   apart from the confirmations you expressly make in these terms.
6. **Acceptance.** Before your contribution is merged, explicitly agree to these
   terms using the pull request checkbox or a written confirmation identifying
   the contribution and the version of these terms you accept. Keep acceptance
   with the contribution's review record. Later edits to these terms do not
   automatically apply to contributions you previously submitted.

Maintainers must verify acceptance before merging outside contributions. For
direct commits or contributions made outside pull requests, obtain and retain
the same written confirmation before incorporating the work. Repository access
alone does not constitute acceptance. If you cannot agree, you can still report
bugs and suggest features without submitting material for inclusion.

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
