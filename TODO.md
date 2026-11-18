# CAT SIMS implementation checklist

This checklist turns the [V1 design](DESIGN.md) into implementation steps. Start with staff access and the registers, then deliver a complete purchase-to-stock workflow before adding stock issue and returns.

## 1. Establish operational access

- [ ] Add a Worker authorization check for a live administrator or an ordinary user linked through Staff Accounts. Keep maintenance, account administration and settings administrator-only. Apply the existing mandatory password-change gate to business requests.
- [ ] Expose only the access information the frontend needs. Use it for navigation and direct-route handling. Keep the Worker as the authority for every business request.
- [ ] Verify access for an administrator, linked staff user, unlinked user, signed-out visitor and account awaiting a mandatory password change. Check that linking an account preserves its credentials and session behaviour.

## 2. Build the cadet, supplier and catalog registers

- [ ] Connect the Cadets screen to the existing D1 table. Add searchable lists, detail, create and edit, and support inactive and left statuses. Confirm the CIN mapping before importing V1 recipients.
- [ ] Add the supplier register with name, address, contact details and active status. Enforce unique supplier names and preserve references to inactive suppliers.
- [ ] Add supplier-linked catalog items and size variants. Support name, description, Blue/Green type, active status and unique item names within each supplier.
- [ ] Add pickers for active records. Allow staff to read the choices needed for operations. Apply administrator-only writes to the registers under the proposed access model in the design.
- [ ] Verify that duplicate records are rejected, inactive records disappear from new picks and existing references still resolve.

## 3. Build purchase orders

- [ ] Add purchase-order headers and lines with an additive D1 migration. Keep the existing stock and order rows available for reconciliation.
- [ ] Add the Orders list, editor and detail view. Filter item choices by supplier, validate positive whole-unit quantities and save the header and all lines together with a unique PO reference.
- [ ] Add printable order details and dashboard counts as each data source becomes available. Show order line counts separately from unit quantities.
- [ ] Verify that a multi-size order saves as Pending, a failed save leaves no partial order, and creating an order leaves stock unchanged.

## 4. Add receiving, back orders and stock balances

- [ ] Add receipt lines linked to purchase-order lines and stock movements linked to size variants. If existing stock needs to carry forward, map it to variants and record opening balances once before switching the stock view to movement totals.
- [ ] Implement Receive from a PO or BO. Calculate remaining units on the server, allow zero on individual lines and require at least one positive quantity. Commit the receipt, inbound movements and updated statuses together.
- [ ] Generate and update back orders for shortages. Confirm whether repeated deliveries should reuse one open BO per PO as proposed in the design. Add the BO list, receipt history, printable details and pending back-order dashboard count.
- [ ] Connect the Stock Management screen to live balances. Show item totals, size breakdowns and movement history.
- [ ] Verify that ordering 10, receiving 6 and later receiving 4 brings stock from 0 to 6 to 10 and closes both records. Check multi-size deliveries, over-receipt rejection, duplicate submissions, concurrent receipts and rollback.

## 5. Add uniform issue, supplier returns and corrections

- [ ] Add multi-line uniform issue to a cadet and multi-line returns to a supplier. Record the actor and stable references. Confirm whether supplier returns need a separate “returned by” field.
- [ ] Validate outbound quantities against available stock by size, including repeated lines for the same variant. Commit each transaction and its movements atomically with retry protection.
- [ ] Add searchable issue and return lists, printable details and Cadet Kit history with distinct line and quantity totals. Confirm whether current holdings and cadet handbacks are a later workflow.
- [ ] Agree who can cancel or reverse records. Add confirmed removal of eligible unposted records and auditable reversals of posted receipts, issues and returns. Recalculate affected order and kit totals and reject reversals that would leave invalid stock or receipt totals.
- [ ] Verify that issuing 2 and returning 1 from a balance of 10 leaves 7, and reversing the issue leaves 9. Check concurrent issues, insufficient stock and historical links after cadet or item edits.

## 6. Finish account administration and branding

- [ ] Add administrator username and role edits and an explicit password reset flow. Staff account entry remains **Username, Password, Role**, and new or reset credentials must follow the agreed first-login and session rules.
- [ ] Define account deactivation or removal, session revocation, attribution for past actions and last-administrator protection before enabling removal.
- [ ] Add system name, short name and About Us settings. Confirm where About Us appears. Configure the approved image storage binding and add verified logo and cover uploads with previews.
- [ ] Verify admin-only access, password reset and session behaviour, and that a failed image upload leaves the previously saved image available.

## 7. Reconcile data and verify release

- [ ] Confirm whether to import V1 data and whether routine CSV import or export is required. For an approved V1 import, rehearse on isolated data and reconcile recipient links, size-level balances, open PO/BO quantities and source references before touching production.
- [ ] Review each changed or moved file against Git, including imports, API contracts, auth, D1 bindings and build paths. Preserve the production D1 ID and keep V1 data and configuration out of staging and published assets.
- [ ] Run isolated checks for each changed workflow as appropriate. Keep source review, dependency audit, Cloudflare build and browser verification distinct. Leave build verification to Cloudflare under the current project instructions.
- [ ] Obtain explicit approval for each GitHub push. After deployment, exercise the full order-to-issue flow and access restrictions with test accounts in the browser. Verify that hosting serves only `build/` and allowed public assets.
