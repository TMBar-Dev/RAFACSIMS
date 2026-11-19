# CAT SIMS implementation checklist

Phase 7 is the owner-led release check. All 26 local schema and API tests passed. Production build, browser and scheduled deployment checks remain open. See the [design](DESIGN.md) for implemented workflows and scope decisions.

## 7. Verify the release

Owner decision. Skip legacy import and data reconciliation. Use fresh test records for the release checks. `V1/` stays local and ignored.

- [ ] Confirm the Cloudflare build and the deployed commit. Verify the existing D1 binding, the `build/` asset path and that direct requests cannot retrieve source files, SQL exports or `V1/`. If provisioning a fresh D1 database, configure the administrator bootstrap secret before first sign-in.
- [ ] In the deployed browser, check sign-in and page access as an administrator, linked staff member, unlinked user and account awaiting a mandatory password change. Verify direct links as well as navigation.
- [ ] As an administrator, create a test cadet, supplier and sized item. Verify register search and edits and confirm inactive options disappear from new transaction pickers.
- [ ] Order 10 units, receive 6 and receive the remaining 4 against the same back order. Check both dashboard counts, receipt history, the stock size balance and purchase-order, back-order and receipt printing.
- [ ] Issue 2 units, return 1 to the supplier and reverse the issue as an administrator. Check balances of 8, 7 and 9, the movement audit, the reversed Cadet Kit entry and printable issue and return details.
- [ ] On a separate test account, verify username or role edits, temporary password reset, deactivation and reactivation. Check previous sessions are revoked as expected. Save test branding and confirm About Us on the dashboard, the cover at sign-in and preservation of the saved image after a rejected upload.
- [ ] Record the deployed commit, date and outcomes. If fixes are needed, review the changed files, rerun affected isolated tests and obtain approval for each additional push. Keep source review, dependency audit, Cloudflare build and deployed browser checks separate.
- [ ] Confirm the existing Worker has the Monday 03:00 UTC trigger and scheduled hook secret. Check for the build ID in Workers Logs after a scheduled run and confirm the result in Workers Builds.

## Development after release verification

1. **Fix issues found during the stores pilot.** Observe a staff member raising a multi-size order, receiving a partial delivery, finding available stock and printing an issue. Prioritize anything that blocks posting or obscures whether a save succeeded. Include keyboard navigation, narrow screens, print output, stale edits and interrupted saves.
2. **Make production support repeatable.** Record how to identify the deployed commit, detect failed builds or Worker errors, roll back code and recover D1. Exercise recovery in a separate database and check account access, open order quantities and stock totals afterwards.
3. **Plan a separate dependency upgrade.** Audit the lockfile and address actionable advisories. Assess supported React and Material UI versions and verify layout, dialogs, form controls and printing against the release baseline.
4. **Validate requests for new scope.** Find out which recurring tasks stores staff cannot complete. Cadet handbacks, current holdings and CSV exchange need explicit requirements before implementation. Keep legacy migration out of this release.
