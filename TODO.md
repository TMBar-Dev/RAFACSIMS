# CAT SIMS implementation checklist

Phases 1–6 are implemented and pushed through commit `0f9a805`. The isolated suite passed all 23 tests for that release candidate. Phase 7 is the owner's release verification. See the [design](DESIGN.md) for the implemented workflows and scope decisions.

## 7. Verify the release

Owner decision. Skip legacy import and data reconciliation. Use fresh test records for the release checks. `V1/` stays local and ignored.

- [ ] Confirm the Cloudflare build and the deployed commit. Verify the existing D1 binding, the `build/` asset path and that direct requests cannot retrieve source files, SQL exports or `V1/`. If provisioning a fresh D1 database, configure the administrator bootstrap secret before first sign-in.
- [ ] In the deployed browser, check sign-in and page access as an administrator, linked staff member, unlinked user and account awaiting a mandatory password change. Verify direct links as well as navigation.
- [ ] As an administrator, create a test cadet, supplier and sized item. Verify register search and edits and confirm inactive options disappear from new transaction pickers.
- [ ] Order 10 units, receive 6 and receive the remaining 4 against the same back order. Check both dashboard counts, receipt history, the stock size balance and purchase-order, back-order and receipt printing.
- [ ] Issue 2 units, return 1 to the supplier and reverse the issue as an administrator. Check balances of 8, 7 and 9, the movement audit, the reversed Cadet Kit entry and printable issue and return details.
- [ ] On a separate test account, verify username or role edits, temporary password reset, deactivation and reactivation. Check previous sessions are revoked as expected. Save test branding and confirm About Us on the dashboard, the cover at sign-in and preservation of the saved image after a rejected upload.
- [ ] Record the deployed commit, date and outcomes. If fixes are needed, review the changed files, rerun affected isolated tests and obtain approval for each additional push. Keep source review, dependency audit, Cloudflare build and deployed browser checks separate.
