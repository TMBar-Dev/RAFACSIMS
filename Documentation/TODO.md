# CAT SIMS release checklist and development priorities

Phase 7 is the owner-led release check. All 30 local schema and API tests passed after the staff account migration and permission changes. The Cloudflare build, scheduled deployment and live browser checks are still open. See [DESIGN.md](DESIGN.md) for implemented workflows and scope decisions.

## 7. Verify the release

Use fresh test records. Legacy import and reconciliation are outside this release, and `V1/` stays local and ignored.

### Deployment

- [ ] Confirm Workers Builds succeeded and record the deployed commit. Check that the Worker uses the existing D1 binding and serves public assets from `build/`.
- [ ] Request known source, SQL export and `V1/` paths and check the response contents. A missing path may return the app shell because of the single-page application fallback. The private file contents must stay inaccessible.
- [ ] Confirm the Monday 03:00 UTC trigger and scheduled hook secret on the existing Worker. Match the scheduled build ID in Workers Logs to its deployment result in Workers Builds.

For a fresh database, [provision the first administrator in D1](../README.md#first-sign-in) before testing sign-in.

For an existing database, record a D1 recovery point before the deployment and verify the migrated `staff` accounts, sessions and workflow permissions. See the [migration notes](../README.md#updating-an-existing-database).

### Sign-in, access and registers

- [ ] Check sign-in, navigation and direct links as an Admin, a User without workflow permissions, accounts with each individual workflow permission, and an account awaiting a mandatory password change.
- [ ] As an administrator, create a test cadet, supplier and sized item. Verify register search and edits. Retire a test option and confirm it disappears from new transaction pickers.

- [ ] Verify the Material UI upgrade in the deployed browser. Check the sign-in layout, native selectors, quantity and password constraints, keyboard focus and print layout.

### Order, receipt and stock correction

Use one test size starting at zero stock so changes can be checked against the ledger.

| Action | Expected result |
| --- | --- |
| Order 10 units | The order is outstanding and stock stays at 0. |
| Receive 6 | Stock is 6. The outstanding order count stays the same and the open back-order count rises by one. The back order shows 4 units remaining. |
| Receive the remaining 4 against the same back order | Stock is 10. The order is fully received and the back order closes. Both dashboard counts fall by one. |
| Issue 2 to the test cadet | Stock is 8. |
| Return 1 to the supplier | Stock is 7. |
| Reverse the 2-unit issue as an administrator | Stock is 9. Cadet Kit shows the reversed issue in history and excludes it from active totals. |

- [ ] Run the scenario and verify the dashboard count changes, receipt history, size balance, movement audit and Cadet Kit entry.
- [ ] Check the printable purchase order, back order, receipts, issue and supplier return.

### Account administration and branding

- [ ] Use a separate test account to check username or role edits, temporary password reset, deactivation and reactivation. Check that changes revoke previous sessions as expected.
- [ ] Save test branding. Verify About Us on the dashboard and the cover at sign-in. Try a rejected upload and confirm that the saved image is still available.

### Record the results

- [ ] Record the date, deployed commit and outcomes. Report the source review, dependency audit, Cloudflare build and deployed browser checks separately.
- [ ] If fixes are needed, review the changed files, rerun affected isolated tests and obtain approval for each additional push. See [AGENTS.md](../AGENTS.md).

## Development after release verification

1. **Fix problems found during the stores pilot.** Observe a staff member raising a multi-size order, receiving part of it, finding stock and printing an issue. Prioritise failures that block posting or make it unclear whether a save succeeded. Check keyboard navigation, narrow screens, print output, stale edits and interrupted saves.
2. **Make production support repeatable.** Document how to identify the deployed commit, detect failed builds or Worker errors, roll back code and recover D1. Exercise recovery in a separate database and check account access, open order quantities and stock totals afterwards.
3. **Plan future dependency upgrades separately.** Audit the lockfile and address actionable advisories. Assess supported React and Material UI versions and check layout, dialogs, controls and printing against the release baseline.
4. **Confirm demand before adding workflows.** Find out which recurring tasks stores staff cannot complete. Cadet handbacks, current holdings and CSV exchange need explicit requirements. Legacy migration remains outside this release.

## Production security review follow-up

- [ ] Verify both Worker builds and the deployed browser flows on a staging Worker with a separate D1 database. Check the idle timeout, CSP and printing, stock adjustments and reversals, audit output and branding cache.
- [ ] Require the GitHub Verify check and a review on `main`. Verify that both Cloudflare projects use the pinned Node version and gated build command. Confirm Monday rebuilds use the intended branch.
- [ ] Configure Cloudflare edge limits for sign-in and public branding, plus alerts for failed deployments, elevated 5xx and 429 rates, and CPU errors. Confirm the Worker plan and inspect password hashing metrics.
- [ ] Confirm two named administrators on each active database, review existing accounts and coordinate password resets with their owners. Rehearse D1 recovery on staging.
- [ ] Agree with the squadron and wing on cadet-data ownership, privacy notices, authorised access, retention, event retention and D1 location and recovery policies. Design anonymisation to cover historical names and free-text remarks while preserving stock records, then agree on backup handling before enabling erasure.
- [ ] Inventory historical references before retiring the unused legacy stock and order tables. Move the remaining schema definitions to explicit D1 migrations after testing both existing databases. Check non-ASCII duplicate handling and frontend accessibility in staging.
