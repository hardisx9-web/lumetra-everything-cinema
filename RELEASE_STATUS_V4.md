# Lumetra V4 educational wings — Release status

**State:** Review candidate; **do not label production-complete**.

Source: isolated copy of Lumetra V3, with the new `public/cinema-learning.js`, `public/learning-data.js`, `public/learning.css`, navigation integrations, tests and research ledger.

## Tests
- Node educational taxonomy and route contract tests: passing.
- Existing responsive, route, artwork, editorial depth, notebook and programming tests: passing.
- Local HTTP preview: shell `/technology`, `/crew/camera`, JS, CSS returned 200.
- Isolated browser markup snapshots: Playwright desktop 1440px and mobile 390px no horizontal overflow in sampled entry pages.
- Full live browser/local-server UI interactions: **not run** because Chromium rejects localhost navigation with ERR_BLOCKED_BY_ADMINISTRATOR.
- Remote Wikimedia image availability/licensing and production Cloudflare deployment: **not run**.

## Content maturity
- Indexed: 250 technology and 309 credit-variant entries.
- Selected deeper explanations: 19 camera milestones, 26 crew titles and 37 departmental context essays.
- Photo links: six; remaining camera eras show labeled original drawings.
- Full worldwide role and equipment completeness is impossible to guarantee as a fixed checklist. Establish continuous audit, region-specific role variants, guild review and moderated omissions process.

## Rollback
No existing deployment was changed. To reject V4, discard its separate preview folder and keep V3. If merging into the original source later, use a Git development branch and retain a commit for rollback.
