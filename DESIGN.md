# CAT SIMS design based on SIS V1

Reviewed 19 November 2026 against source commit `8737715`.

## Scope and release status

Phases 1–6 implement the core V1 workflows in the existing React application, Cloudflare Worker and D1 database. All 26 SQLite-backed schema and API tests passed on Node 24 with the runner in a single process. Cloudflare build, scheduled deployment and deployed browser verification remain open in the [release checklist](TODO.md).

The reference is the local PHP application in `V1/SIS`, with SQL exports at `V1/sis_db.sql` and `V1/SIS/database/sms_db.sql`. Where exports and PHP disagree, the application workflows and posted stock behaviour guide the design. The XAMPP dashboard and older application copy are reference material. Legacy import and reconciliation are outside this release. `V1/` stays local and ignored.

## Screen and workflow inventory

| V1 area | Implemented CAT SIMS behaviour |
| --- | --- |
| Sign-in and My Account | Username/password sign-in and public registration, session restoration, logout and password change. New or reset administrator-created credentials require replacement at next sign-in. Staff account creation requires **Username, Password and Role**. V1 reference is `V1/SIS/classes/Login.php`. |
| Dashboard | Shows outstanding purchase-order and back-order counts to operational users and links to both lists. A partial PO with an open BO is counted once in each list. Navigation groups related work and reflects account permissions. About Us appears on the signed-in dashboard. V1 reference is `V1/SIS/admin/home.php`. |
| Orders | Orders have one supplier, multiple item/size lines, whole quantities, remarks, printable detail and a stable `PO-` reference. Staff and administrators can edit pending orders until the first receipt. Administrators can cancel an unreceived order with a reason. V1 reference is `V1/SIS/admin/purchase_order`. |
| Receiving | Receive from purchase-order or back-order details. Receipts show the supplier, actor, reference, quantities and remarks, with search and print. Administrators correct a posted receipt through a reversal. V1 reference is `V1/SIS/admin/receiving`. |
| Back Orders | A partial delivery opens one BO reference for the PO. Later deliveries reuse it. The detail view shows ordered, received and remaining quantities, provides print and receipt history, and links to receiving. V1 reference is `V1/SIS/admin/back_order`. |
| Stock Management | Shows availability by item and size with indexed movement lookups, and links movements to transaction history. Administrators can review and reverse any opening balances already posted. V1 reference is `V1/SIS/admin/stocks/index.php`. |
| Issue Uniform | Select an active cadet and available sizes, post multiple lines and print the resulting issue. History preserves the recipient name at posting. V1 reference is `V1/SIS/admin/sales`. |
| Supplier Returns | Select an active supplier and available sizes from its items. A posted return reduces stock and retains the signed-in actor, remarks and a printable reference. V1 reference is `V1/SIS/admin/return`. |
| Cadet Kit | Shows issue history by cadet, including reversed references, with issue, line and unit counts for unreversed issues. Cadets with historical issues remain discoverable after leaving. V1 reference is `V1/SIS/admin/Issued_Cadet/index.php`. |
| Supplier, Client and Item Lists | Suppliers have contact details and active status. Cadets provide the recipient register with names and an optional service number. Catalog items belong to a supplier and have Blue/Green type, with size variants managed separately. Administrators maintain these registers and retired entries remain linked in history. V1 reference is `V1/SIS/admin/maintenance`. |
| User List | Administrators manage other accounts by username and role, set temporary passwords, and deactivate or reactivate sign-in access. Staff links and historical actor references survive these operations. V1 reference is `V1/SIS/admin/user`. |
| Settings | Administrators edit system and short names, About Us, and logo and sign-in cover images. The browser previews selected images and the Worker validates uploaded bytes before replacing either slot. V1 reference is `V1/SIS/admin/system_info/index.php`. |

Live register and transaction lists use search and cursor pagination with stable ID ordering. Printable transaction details show the reference, relevant supplier or recipient, date, quantities and remarks where present. Lists distinguish line counts from unit totals.

## Access and account lifecycle

| Account | Access after any required password change |
| --- | --- |
| Administrator | All operations and registers, account management, branding, order cancellation, stock reversals and opening-balance mapping. |
| Linked staff | A regular user with a Staff Accounts link. Can read active register records and use orders, receiving, back orders, stock, issues, supplier returns and Cadet Kit. |
| Unlinked signed-in user | Account controls and the basic dashboard with About Us. Public registration alone grants no operational access. |
| Signed out or awaiting a mandatory password change | Sign-in and relevant account maintenance. Public branding is available before sign-in. |
| Deactivated account | Sign-in is blocked until another administrator reactivates the account. Historical references stay attached to the original account. |

The Worker checks the live session and role, and checks staff membership for operational access. Navigation follows those permissions. Identity edits, administrator resets and deactivation revoke the target user's sessions. Reactivation retains any pending password change and requires a new login. Administrators manage other users only, and the write rechecks the acting administrator so concurrent changes cannot remove the last ready administrator. The bootstrap username `admin` is reserved. Staff account entry uses username, password and role. Cadet records remain separate from login identities.

## Order and stock rules

1. **Create a purchase order.** Save one header and its lines atomically against an active supplier and its active item sizes. Quantities are positive whole units. The supplier stays fixed after creation. Retained lines keep their IDs and recorded labels. An order on its own leaves stock unchanged.
2. **Receive a delivery.** Enter any quantities up to the server-calculated remainder, including zero on individual lines. At least one line must be positive. The receipt, movements and derived status changes commit together. A PO becomes Partially received when a delivery leaves a shortage and Received when every line is filled.
3. **Manage shortages.** The first partial delivery creates a BO. The remainder comes from ordered quantities minus net posted receipt movements. Once received, the BO closes and stays in history. A later receipt reversal may reopen that same BO.
4. **Issue or return stock.** A uniform issue to a cadet and a return to a supplier both decrease stock. The ledger validates combined demand by variant and rejects operations that would make a size balance negative.
5. **Correct a record.** Administrators cancel a pending PO with no receiving history or reverse a posted receipt, issue or supplier return with a reason. Reversals preserve the original and record opposing movements. An invalid reversal rolls back. Any receiving history prevents PO edits, including when all receipts are reversed.

For example, order 10 of a size and receive 6. Stock rises to 6 and a BO shows 4 remaining. Receive those 4 against the BO to close both records and bring stock to 10. Issue 2 and return 1 to the supplier to leave 7 available. Reverse the issue to restore the balance to 9 and remove its units from the unreversed Cadet Kit total.

## Data and API design

| Storage | Relationships and responsibilities |
| --- | --- |
| `users`, `sessions`, `staff`, `account_deactivations` | Existing account and staff IDs remain stable. Deactivation records block sign-in and revoke sessions without removing attribution. See [account administration](account-admin.js). |
| `cadets`, `suppliers`, `catalog_items`, `catalog_variants` | The registers supply operational choices. Catalog items belong to suppliers and variants belong to catalog items. Active statuses filter new choices. See [management schema](schema.js). |
| `purchase_orders`, `purchase_order_lines`, `purchase_order_cancellations`, `back_orders` | The order holds supplier and status. Lines hold stable variant references and ordered quantities. The BO has one reference per originating PO. Cancellations preserve the actor, reason and original order. |
| `inventory_transactions`, `stock_movements` | A header records a receipt, issue, supplier return, opening balance or reversal. Each ledger row links a variant to a signed movement and the original PO line where applicable. Views derive size availability and purchase-line remainders. See [inventory schema](inventory-schema.js). |
| `branding_settings`, `branding_images` | System names, About Us and two bounded image slots use the existing D1 binding. The logo accepts PNG/JPEG up to 128 KiB and 1,024 pixels per side. The cover accepts PNG/JPEG up to 512 KiB and 2,560 pixels per side. See [branding implementation](branding.js). |

The Worker uses same-origin JSON writes with byte-bounded bodies, live access checks and bounded list reads. Database batches and movement validation enforce order remainders and stock availability at commit time. Transaction request IDs and the account-scoped status endpoint support interrupted saves, and version checks reject stale register and purchase-order edits. Fresh administrator provisioning uses a deployment secret. Branding metadata and the two image slots have public read endpoints with bounded revision history for recovery. About Us requires a ready signed-in session. See the [API reference](README.md#api).

## V1 differences and scope decisions

| V1 finding | CAT SIMS decision |
| --- | --- |
| The issue code and SQL disagree on the client field, and the bundled dump lacks `client_list`. | Use stable cadet IDs and retain the recipient label at posting. Legacy recipients and CIN mapping are outside this release. |
| The root dump requires stock `bg` but movement inserts omit it. | Keep Blue/Green on catalog items and record movements by size variant. |
| V1 back-order update and deletion paths can lose or misstate shortages. | Derive shortages from net receipts and retain one BO reference per order. |
| The return list displays `returned_by` but its form does not capture it. | Record the signed-in actor. A separate return-contact field is outside current scope. |
| V1 Cadet Kit counts stock row IDs and has inconsistent headings. | Report issue history with distinct line and unit totals. Cadet handbacks, losses, swaps and current holdings are outside current scope. |
| V1 pages expose permanent deletes and the SQL cascades some supplier and item deletions. | Retire register entries, deactivate accounts, cancel eligible orders, and reverse posted transactions while retaining history. |
| Earlier CAT SIMS templates displayed CSV actions, and the requested release skips legacy import. | Use search, lists and printable details. CSV import and export are outside this release. |

## Phases and verification

| Phase | Status |
| --- | --- |
| 1. Operational access | Implemented. Isolated tests cover authentication, role gates, staff links and mandatory password changes. |
| 2. Cadet, supplier and catalog registers | Implemented. Isolated tests cover search, pagination, duplicate checks and active choices. |
| 3. Purchase orders | Implemented. Isolated tests cover multi-size orders, retries, stale edits and rollback. |
| 4. Receiving, back orders and stock | Implemented. Isolated tests cover partial and complete receipts, repeat requests, competing writes and stock balances. |
| 5. Uniform issue, supplier returns and corrections | Implemented. Isolated tests cover insufficient stock, competing issues, reversal history, cancellations and Cadet Kit totals. |
| 6. Account administration and branding | Implemented. Isolated tests cover resets, session revocation, last-administrator protection, upload permissions and preservation of a saved image after failure. |
| 7. Release verification | Owner-led. Confirm the Cloudflare build and exercise the deployed browser workflows in [TODO.md](TODO.md#7-verify-the-release). |

Deployment retains the existing D1 binding and publishes `build/` with the explicit static asset allowlist. Branding images are served through the Worker. Source review and isolated tests establish local verification. Deployed browser behaviour and Cloudflare build results are recorded separately during Phase 7.

## Deployment and development implications

The existing Worker handles the Monday 03:00 UTC scheduled event. Cloudflare Trigger Events manages the schedule. The handler calls Workers Builds using a runtime secret and records the acknowledged build ID. Deployment and browser verification remain separate checks. See the [deployment configuration](README.md#weekly-and-post-push-deployment).

Verify the full order, receipt, issue and reversal sequence on the deployed Worker and D1. Use the first stores pilot to identify workflow improvements, including recovery after interrupted saves. Exercise D1 recovery separately and check that the procedure preserves account access, order remainders and the stock ledger. Keep dependency upgrades separate so navigation, dialogs and printing can be verified against the same baseline. See the [development backlog](TODO.md#development-after-release-verification).
