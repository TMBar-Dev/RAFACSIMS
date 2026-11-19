# CAT SIMS design based on SIS V1

Source baseline reviewed on 19 November 2026 at commit `8737715`.

## Scope and release status

Phases 1–6 implement the core V1 workflows in the existing React application, Cloudflare Worker and D1 database. All 26 SQLite-backed schema and API tests passed on Node 24 with the runner in a single process. Cloudflare build, scheduled deployment and deployed browser verification remain open in the [release checklist](TODO.md).

The design uses the PHP application in `V1/SIS` and the SQL exports at `V1/sis_db.sql` and `V1/SIS/database/sms_db.sql`. Where the exports and PHP disagree, the application workflows and posted stock behaviour guide the design. The XAMPP dashboard and older application copy are reference material.

`V1/` is an optional local checkout of the reference. Git ignores the folder. Legacy import and reconciliation are outside this release.

Jump to the [workflow inventory](#screen-and-workflow-inventory), [account lifecycle](#access-and-account-lifecycle), [stock rules](#order-and-stock-rules) or [V1 decisions](#v1-differences-and-scope-decisions).

## Screen and workflow inventory

PO means purchase order and BO means back order. Reference paths in these tables are relative to the optional local `V1/SIS/` folder.

### Accounts and dashboard

| Screen | CAT SIMS behaviour | V1 reference |
| --- | --- | --- |
| Sign-in and My Account | Supports username and password sign-in, public registration, session restoration, logout and password changes. Administrator-created or reset accounts must replace the temporary password at next sign-in. | `classes/Login.php` |
| Dashboard | Links operational users to outstanding POs and BOs. A partial PO with an open BO counts in both totals. Navigation follows account permissions. The signed-in dashboard displays About Us. | `admin/home.php` |
| User List | Administrators edit other accounts by username and role, set temporary passwords and deactivate or reactivate sign-in access. Staff links and historical actor references survive these changes. | `admin/user` |

### Orders and stock

| Screen | CAT SIMS behaviour | V1 reference |
| --- | --- | --- |
| Orders | Each printable order has one supplier, item and size lines, whole-unit quantities, remarks and a stable `PO-` reference. Staff and administrators can edit pending orders until the first receipt. Administrators can cancel an eligible order with a reason. | `admin/purchase_order` |
| Receiving | Post deliveries from PO or BO details. Search or print receipts showing supplier, actor, reference, quantities and remarks. Administrators correct receipts through a reversal. | `admin/receiving` |
| Back Orders | A partial delivery opens one BO per PO. Its reference is reused for later deliveries. The printable detail shows ordered, received and remaining quantities, with links to receipt history and receiving. | `admin/back_order` |
| Stock Management | Shows availability by item and size and links indexed movements to transaction history. Administrators can review and reverse previously posted opening balances. | `admin/stocks/index.php` |
| Issue Uniform | Select an active cadet and available sizes, post multiple lines and print the issue. History preserves the recipient name at posting. | `admin/sales` |
| Supplier Returns | Select an active supplier and available sizes for its items. A posted return decreases stock and retains the actor, remarks and printable reference. | `admin/return` |
| Cadet Kit | Shows issue history, including reversed references. Totals count unreversed issues, lines and units separately. Cadets with historical issues remain searchable after leaving. | `admin/Issued_Cadet/index.php` |

Register and transaction lists use search and cursor pagination with stable ID ordering. Printable transaction details show the reference, relevant supplier or recipient, date, quantities and remarks where applicable.

### Registers and settings

| Screen | CAT SIMS behaviour | V1 reference |
| --- | --- | --- |
| Suppliers, cadets and catalog | Administrators maintain supplier contact details, cadet names and optional service numbers, and Blue/Green items with size variants. Catalog items belong to suppliers. Retired entries stay linked in history. | `admin/maintenance` |
| Settings | Administrators set the system name, short name, About Us, logo and sign-in cover. The browser previews selections and the Worker validates uploaded bytes before replacing an image. | `admin/system_info/index.php` |

## Access and account lifecycle

| Account | Access |
| --- | --- |
| Administrator | All stores workflows and registers, plus account management, branding, cancellations, reversals and review of existing opening balances. |
| Linked staff | A regular user with a Staff Accounts link. Can read active register records and use orders, receiving, back orders, stock, issues, supplier returns and Cadet Kit. |
| Unlinked signed-in user | Account controls and the basic dashboard with About Us. Public registration alone grants no operational access. |
| Awaiting a mandatory password change | Password change and sign-out. Stores access starts once the password is replaced. |
| Signed out | Sign-in, public registration and public branding. |
| Deactivated account | Sign-in is blocked until another administrator reactivates the account. Historical references stay attached to the original account. |

- **Live access checks.** The Worker checks the session, current role and, when required, the staff link on protected requests. Navigation reflects the same permissions.
- **Account changes.** Username or role edits, administrator resets and deactivation revoke the target user's sessions. Reactivation preserves a pending password change and requires a new sign-in.
- **Administrator continuity.** Administrators manage other users. Writes recheck the acting administrator and protect the last administrator who can sign in and use the app, including during concurrent changes. The bootstrap username `admin` is reserved.
- **Staff creation.** Creating a new staff account uses **Username**, **Password** and **Role**. A staff record can also link an existing login. Cadet records have their own identities.

## Order and stock rules

1. **Create a purchase order.** Save one header and its lines atomically against an active supplier and its active item sizes. Quantities are positive whole units. The supplier stays fixed after creation. Retained lines keep their IDs and recorded labels. An order on its own leaves stock unchanged.
2. **Receive a delivery.** Enter any quantities up to the server-calculated remainder, including zero on individual lines. At least one line must be positive. The receipt, movements and derived status changes commit together. A PO becomes Partially received when a delivery leaves a shortage and Received when every line is filled.
3. **Manage shortages.** The first partial delivery creates a BO. The remainder comes from ordered quantities minus net posted receipt movements. Once received, the BO closes and stays in history. A later receipt reversal may reopen that same BO.
4. **Issue or return stock.** A uniform issue to a cadet and a return to a supplier both decrease stock. The ledger validates combined demand by variant and rejects operations that would make a size balance negative.
5. **Correct a record.** Administrators cancel a pending PO with no receiving history or reverse a posted receipt, issue or supplier return with a reason. Reversals preserve the original and record opposing movements. An invalid reversal rolls back. Any receiving history prevents PO edits, including when all receipts are reversed.

### Worked example for one uniform size

Start with zero units in stock. The same order and back-order references carry through both deliveries.

| Action | Units in stock | Order status |
| --- | ---: | --- |
| Order 10 units | 0 | Pending |
| Receive 6 units | 6 | Partially received, with 4 units on back order |
| Receive the remaining 4 against the back order | 10 | Received, with the back order closed |
| Issue 2 units to a cadet | 8 | Received |
| Return 1 unit to the supplier | 7 | Received |
| Reverse the 2-unit issue | 9 | Received |

The reversed issue remains visible in Cadet Kit history. Its two units are removed from the unreversed total.

## Data and API design

| Storage | Relationships and responsibilities |
| --- | --- |
| `users`, `sessions`, `staff`, `account_deactivations` | Existing account and staff IDs remain stable. Deactivation records block sign-in and revoke sessions without removing attribution. See [account administration](account-admin.js). |
| `cadets`, `suppliers`, `catalog_items`, `catalog_variants` | The registers supply operational choices. Catalog items belong to suppliers and variants belong to catalog items. Active statuses filter new choices. See [management schema](schema.js). |
| `purchase_orders`, `purchase_order_lines`, `purchase_order_cancellations`, `back_orders` | The order holds supplier and status. Lines hold stable variant references and ordered quantities. The BO has one reference per originating PO. Cancellations preserve the actor, reason and original order. |
| `inventory_transactions`, `stock_movements` | A header records a receipt, issue, supplier return, opening balance or reversal. Each ledger row links a variant to a signed movement and the original PO line where applicable. Views derive size availability and purchase-line remainders. See [inventory schema](inventory-schema.js). |
| `branding_settings`, `branding_images` | System names, About Us and two bounded image slots use the existing D1 binding. Saved image revisions support recovery after a faulty upload. See the [branding implementation](branding.js) and [upload limits](README.md#branding). |

### Why the safeguards exist

- **Prevent partial writes.** D1 batches commit related records together. Database checks enforce order remainders and stock availability even when requests compete.
- **Recover interrupted saves.** Store a request ID with a new order or transaction. A matching retry can return the original reference, and the author can check its posting status before initiating another write.
- **Catch stale edits.** Register and purchase-order edits include the version read by the editor. The API rejects a stale version so it cannot overwrite a newer save.
- **Limit public access.** Metadata and image slots are public for the sign-in screen. About Us requires sign-in and completion of any mandatory password change. Fresh administrator provisioning requires a deployment secret.

The Worker accepts same-origin JSON writes with bounded bodies and serves bounded list pages. See the [API reference](README.md#api).

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

Deployment retains the existing D1 binding and publishes `build/` with the explicit static asset allowlist. Branding images are served through the Worker. Phase 7 records the Cloudflare build and deployed browser results separately from source review and local test results.

## Deployment and development implications

The existing Worker handles the Monday 03:00 UTC scheduled event. Cloudflare Trigger Events manages the schedule. The handler calls Workers Builds using a runtime secret and records the acknowledged build ID. Deployment and browser verification remain separate checks. See the [deployment configuration](README.md#weekly-and-post-push-deployment).

Verify the full order, receipt, issue and reversal sequence on the deployed Worker and D1. Use the first stores pilot to identify workflow improvements, including recovery after interrupted saves. Exercise D1 recovery separately and check that the procedure preserves account access, order remainders and the stock ledger. Keep dependency upgrades separate so navigation, dialogs and printing can be verified against the same baseline. See the [development backlog](TODO.md#development-after-release-verification).
