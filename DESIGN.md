# CAT SIMS design based on SIS V1

18 November 2026 · Design for review

## Scope and reference

Reproduce the SIS V1 workflows for ordering, receiving, stock, uniform issue, supplier returns, cadet kit and administration in the current CAT SIMS application. The existing React interface and Cloudflare Worker with D1 are the starting point. Preserve the current top-level source layout, production D1 binding, credentials and sessions. Staff accounts require only **Username**, **Password** and **Role**. Cadet names remain part of cadet records.

The review uses the active PHP tree in `V1/SIS`, the root SQL export (`V1/sis_db.sql`) and the bundled SQL export (`V1/SIS/database/sms_db.sql`). When these disagree, the visible PHP screens and their handlers establish intended behaviour where possible. The SQL exports describe possible source data shapes. The outer XAMPP dashboard is installation material, and `V1/Old version` is an older reference copy. The V1 source paths refer to the local reference copy. This is a source review. The reference application and current changes have yet to be exercised in a browser for this design.

## Screen and workflow inventory

| V1 area | Behaviour visible in source | CAT SIMS design |
| --- | --- | --- |
| Sign-in and My Account | Username/password sign-in, signed-in navigation, account edit and logout. See login and account screens (`V1/SIS/admin/user`) and session entry points (`V1/SIS/classes/Login.php`). | Keep existing sign-in, registration, logout and forced first password change. Use the username in the account menu. Bring account changes into the existing account area. |
| Dashboard | Counts purchase orders and back orders with a status other than Received. See `V1/SIS/admin/home.php`. | Display live outstanding counts for each and link to the corresponding list. An order with an open back order counts in both respective totals. |
| Orders | Create a purchase order with one supplier, multiple item/size/quantity lines and remarks. Filter the item picker to the selected supplier. The list shows creation date, PO code, supplier, line count and status, with View, Edit, Delete and a Receive action for pending orders. Details can print. See purchase orders (`V1/SIS/admin/purchase_order`). | Add searchable orders, multi-line editing, detail/print and lifecycle-aware actions. Generate a stable code such as `PO-0001`. Orders alone leave stock unchanged. |
| Receiving | Starts from a PO or BO. Shows its existing lines, accepts quantities from zero to the amount due and adds received stock. A shortage updates the status and generates remaining back-order lines. Separate receipt list and detail pages support view, edit, delete and print even though Receiving has no main sidebar link. See `V1/SIS/admin/receiving` and transaction handlers (`V1/SIS/classes/Master.php`). | Start from the order or back order. Offer receipt history through linked details, with printable receipts and validated corrections. |
| Back Order | Lists supplier, code, line count and status. Details show the originating PO and outstanding lines. The visible list offers View and Receive for pending entries. See back orders (`V1/SIS/admin/back_order`). | Generate `BO-0001`-style references from shortages. Keep the PO and receipt links. Define repeat receiving against the open remainder as described below. |
| Stocks | Shows item, supplier, description and availability. Availability is the sum of inbound less outbound stock, aggregated by item. See stock list (`V1/SIS/admin/stocks/index.php`). | Make the stock template functional. Show the item total and allow viewing size-level balances and movement history. |
| Issue Uniform | Select an active recipient from Client List and active items. Capture item, size, quantity and remarks. A saved issue creates outbound stock. Issue list supports View, Edit and Delete, and details can print. See issue screens (`V1/SIS/admin/sales`). | Select a cadet by stable ID and save a multi-line `ISSUE-0001`-style record. Validate stock for each size and add the issue to the cadet history. Retain the recorded recipient label for historical display. |
| Return List | Select a supplier and its active items, then record size, quantity and remarks. The handler writes outbound stock. Lists show date, returned-by label and line count. Records have detail/print and edit/delete actions. See return screens (`V1/SIS/admin/return`). | Treat this workflow as **return to supplier**, using `R-0001`-style codes. Record the acting username. A cadet handing kit back is a separate inbound workflow pending confirmation. |
| Cadet Kit | The page headed “Issued” reads issue records, but the rendered cells and headings disagree. It has no reliable per-cadet aggregation. See Cadet Kit (`V1/SIS/admin/Issued_Cadet/index.php`). | Show per-cadet issue history and totals backed by issue lines. Label quantity totals and line counts separately. Treat on-hand kit totals as a later addition if cadet handbacks are in scope. |
| Supplier List | Create, view, edit and delete suppliers. Name, address, contact person, contact number and active/inactive status. Duplicate names are checked when saving. See maintenance screens (`V1/SIS/admin/maintenance`). | Keep supplier maintenance admin-only. Inactive suppliers remain visible in history and are excluded from new orders and supplier returns. |
| Client List | Create, view, edit and delete recipients with name, CIN and active/inactive status. The issue picker reads this list. A separate `clients/` folder reads user records and has no link in the active sidebar. See Client List (`V1/SIS/admin/maintenance/client.php`) and alternate client screens (`V1/SIS/admin/clients`). | Use Cadets as the working recipient register. Retain name, identifier and status. Confirm the mapping from CIN to the existing service number before any import. |
| Item List | Create, view, edit and delete catalog items with name, description, supplier, Blue/Green type and active/inactive status. Name is checked for duplicates within the supplier. See item form (`V1/SIS/admin/maintenance/manage_item.php`). | Keep catalog maintenance admin-only. Store item type separately from size and preserve inactive items in historical records. |
| User List | Administrators can create, edit and delete users. The V1 roles are Administrator and Staff. See user administration (`V1/SIS/admin/user`). | Keep the current account and staff-link flows. Add username/role edits and an explicit password reset flow in the administration chunk. Define account removal and session effects before enabling it. |
| Settings | Edit system name, short name, About Us, logo and cover image, with previews for both uploads. The active sign-in page uses the cover. See settings screen (`V1/SIS/admin/system_info/index.php`) and settings handler (`V1/SIS/classes/SystemSettings.php`). | Store settings in D1 and uploaded images in a dedicated storage binding. Preserve the last saved image if an upload fails. Confirm where About Us should appear because the active entry point leads to sign-in. |

List pages generally use DataTables for search, sorting and pagination. CAT SIMS should use its own interface with those behaviours where relevant, plus clear loading, empty and error states. Use line counts for V1-style transaction lists and quantities where the screen promises total units. Printable details should include the reference, supplier or cadet, dates, remarks and line quantities.

## Access model

V1 shows operations to signed-in users of its admin module and shows Maintenance to accounts of type 1. Its separate login module and menu checks do not establish a dependable permission contract. CAT SIMS should enforce the following proposed access rules in every Worker endpoint and mirror them in navigation.

| Account | Access |
| --- | --- |
| Administrator | Operational workflows, dashboard counts, maintenance, settings and user management after any mandatory password change. |
| Staff | Existing `user` role with a staff link created by an administrator. Can see operational counts, read relevant catalog and recipient choices, and use purchasing, receiving, stock, uniform issue, supplier returns and cadet kit. |
| Other signed-in user | Existing account features. Public registration alone grants no access to operational or cadet data. |
| Signed out or awaiting mandatory password change | Existing authentication and password-change flows. Business data requires a live eligible session and completed password change. |

Use the existing Staff Accounts create/link workflow to grant operational access. Keep recipient data separate from login identities. Check staff eligibility and role from D1 on each business request. Add account deletion or deactivation only after defining recovery, audit history, and protection against losing the last administrator.

## Stock and order rules

1. **Create the order.** Save one purchase-order header and one or more item/size/quantity lines in a single operation. Validate the supplier, supported item type and positive whole-unit quantities. Preserve separate sizes of the same item on distinct lines.
2. **Receive stock.** Load eligible lines and calculate remaining units on the server. Permit zero for individual lines during a partial delivery, require at least one positive line and cap each quantity at the remaining units. For every positive quantity, record an inbound movement tied to the source line. Save receipt, movements, order status and back-order changes together.
3. **Handle shortages.** A PO is Pending before its first receipt, Partially received while some units remain and Received once all units arrive. On partial receipt create a BO for the missing quantities. Proposed behaviour for repeated deliveries is to keep one open BO per PO, update its remainder after each delivery and close it when nothing remains. The same BO reference stays visible in history.
4. **Issue or return stock.** Issue to a cadet or return to a supplier using separate transaction types. Both consume stock in V1. Validate availability for each item/size, including the combined demand of repeated lines. Reject insufficient stock without creating a partial record.
5. **Correct a transaction.** Preserve its reference and history. For posted activity, use a reversal or replacement whose net effect is checked against current stock and order totals. Refuse a correction that would leave negative stock or receipts in excess of the amended order. Offer confirmed deletion for unposted records and reversals for posted records.

For example, order 10 of a single size and receive 6. Stock rises by 6, the PO becomes Partially received and 4 appear on a BO. Receive 4 against that BO to close both records and bring stock to 10. Issue 2 to a cadet and return 1 to the supplier to leave 7 available. Reversing the issue restores 2 units and updates the cadet history.

## Data and API design

The existing [schema](schema.js) has a supplier-free stock row with a stored quantity and an orders table with one stock item per order. Add the structures needed for V1 without rewriting existing records in place. Final names and migration SQL belong to the implementation chunk.

| Proposed structure | Relationships and responsibilities |
| --- | --- |
| Users, sessions and staff | Retain the existing authentication tables and staff links. Store account ID on new operational records so historic actions can be attributed. Preserve existing staff and order references. |
| Cadets | Reuse the current cadet register with a stable ID. Decide if CIN needs its own field after checking real data. Historical issues keep their recorded recipient details when a cadet is renamed or leaves. |
| Suppliers, catalog items and size variants | Each item belongs to one supplier. Each variant belongs to one item and represents a particular size. Maintain a link or migration mapping for existing stock rows. |
| Purchase orders and order lines | Header holds supplier, code, status, actor and remarks. Lines hold variant and ordered quantity. Keep immutable IDs for receipt matching. |
| Receipts and receipt lines | Receipt records the PO and optional BO. Each receipt line refers to its originating order line and creates an inbound movement. |
| Back orders and back-order lines | Link to the PO and its outstanding order lines. Keep receipt links so the outstanding quantity can be reconciled from posted deliveries. |
| Issues, supplier returns and their lines | Issue header links to a cadet. Supplier-return header links to a supplier. Each line creates an outbound movement. |
| Stock movements | Record variant, signed unit change, timestamp, actor, source line and reversal reference where applicable. Compute availability from movements. Where existing stock quantities must carry forward, create a one-time opening balance so the same stock is counted once. |
| System settings | Store text and allowed image references in D1. Deliver only verified logo and cover images through the designated asset path. |

Keep the Worker JSON API and its existing auth and write checks. Each list should accept a bounded page size, search and stable sort rules. Details and mutations use stable IDs, while human-readable references remain suitable for printing and search. State changes derive from committed data. Use database uniqueness for codes and atomic writes with retry protection for receipts, issues, returns and reversals. Verify that concurrent requests cannot consume the same remaining units or oversell a size. Report validation and state conflicts in the same forms that triggered them.

## V1 discrepancies and decisions to confirm

| Finding from source | Implication for replication |
| --- | --- |
| PHP issue screens use `client_name`, while both SQL exports define `sales_list.client`. The bundled dump also lacks `client_list`. | Treat the Client List picker as the intended UI. Before importing any data, inspect the actual export shape and reconcile recipient matches. |
| The root dump includes a required stock `bg` column without a default. Movement inserts in the PHP handlers omit it. | Keep Blue/Green on the catalog item, with size and quantity recorded on each stock operation. Verify historical type placement during import review. |
| Back-order updates refer to a column inconsistent with the header schema, and the separate manage screen saves through the PO handler. Original receiving/delete paths can reset status without reconciling all receipts. | Use posted receipt totals as the source of truth. The stable open BO and reversal design above is proposed for review. |
| The supplier-return list reads `returned_by`, but the return form does not capture it. Updating a return attempts an invalid stock statement before adding new outbound lines. | Make the recorded actor explicit and apply corrections atomically. Confirm whether the business also needs a separate “returned by” person. |
| Cadet Kit counts issue stock-row IDs and its table has inconsistent headings. The old SQL includes commercial fields absent from the uniform issue UI. | Treat Cadet Kit as operational issue history. Confirm whether it should also show a current holdings view and capture cadet handbacks, losses or swaps. |
| PHP lists allow several permanent deletes, and the root dump cascades some supplier/item deletions into operational data. | Preserve the ability to correct mistakes through archive, cancellation or reversal. Confirm the allowed correction permissions and any retention requirements before enabling those actions. |
| Existing CAT SIMS templates show disabled import/export actions, while the reviewed V1 management flows use search, filters and print. | Plan V1 data import as a separately reviewed migration. Confirm any day-to-day CSV requirements before adding import/export features. |

## Implementation chunks and acceptance

| Chunk | Deliverable and acceptance checks |
| --- | --- |
| 1. Design | Review the reference workflow inventory, proposed access rules and interpretation of the source discrepancies. |
| 2. Cadets, suppliers and catalog | Working registers and active pickers. Verify duplicate handling, historical links, field mapping and operational access gates. |
| 3. Orders, receiving and back orders | Multi-line orders, partial and full receipts, printable details and dashboard counts. Verify mixed sizes, zero lines in a partial delivery, repeat receipts, retry and concurrent submissions, rollback and corrections. |
| 4. Stock, issues, returns and cadet kit | Ledger-backed availability, printable issue/return records and history by cadet. Verify the worked stock example, oversized issue rejection, size-level isolation and reversals. |
| 5. Accounts and settings | Finish account administration and branding with the approved roles and account-removal rules. Verify forced password change, live permission checks, safe uploads, failed upload recovery and existing login behaviour. |
| 6. Data reconciliation and release | If data import is requested, verify mappings and totals using an isolated copy. Compare recipient links, per-variant balances, open PO/BO quantities and source references before touching production. Run Cloudflare build and deployed browser smoke checks using test accounts for each role. |

Keep `V1/` local as reference material. Deployment continues to publish `build/` and its explicit asset allowlist. Use sanitised fixtures for tests and documentation, and leave V1 account data and local configuration out of deployment and Git staging. Track source review, isolated tests, Cloudflare build and browser verification as distinct checks.
