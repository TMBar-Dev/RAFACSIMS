# CAT SIMS implementation checklist

This checklist turns the [V1 design](DESIGN.md) into implementation steps. Start with staff access and the registers, then deliver a complete purchase-to-stock workflow before adding stock issue and returns.

## 1. Establish operational access

- [x] Add a Worker authorization check for a live administrator or an ordinary user linked through Staff Accounts. Keep account administration administrator-only and require a completed first-login password change. Apply these gates to maintenance, settings and business endpoints as they are added.
- [x] Expose only the access information the frontend needs. Use it for navigation and direct-route handling. Keep the Worker as the authority for every business request.
- [x] Verify Worker access for an administrator, linked staff user, unlinked user, signed-out visitor and account awaiting a mandatory password change. Check that linking an account preserves its credentials and existing session.

## 2. Build the cadet, supplier and catalog registers

- [x] Connect the Cadets screen to the existing D1 table. Add searchable lists, detail, create and edit, and support inactive and left statuses.
- [x] Add the supplier register with name, address, contact details and active status. Enforce unique supplier names and preserve references to inactive suppliers.
- [x] Add supplier-linked catalog items and size variants. Support name, description, Blue/Green type, active status and unique item names within each supplier.
- [x] Add active supplier and variant pickers for purchase orders. Make active cadets available for the future uniform issue picker. Allow staff to read active records and restrict register writes to administrators.
- [x] Verify in isolated API tests that duplicate records are rejected, inactive records disappear from new picks and existing references still resolve.

## 3. Build purchase orders

- [x] Add purchase-order headers and lines through additive D1 initialization. Keep the existing stock and order rows available for reconciliation.
- [x] Add the Orders list, editor and detail view. Filter item choices by supplier, validate positive whole-unit quantities and save the header and all lines together with a unique PO reference.
- [x] Add printable order details and the pending-order dashboard count. Show order line counts separately from unit quantities.
- [x] Verify in isolated API tests that a multi-size order saves as Pending, a failed save leaves no partial order, and creating an order leaves stock unchanged.

## 4. Add receiving, back orders and stock balances

- [x] Add receipt lines and stock movements. Add administrator mapping to carry each existing stock row into a catalog size as one opening balance.
- [x] Implement Receive from a PO or BO. Calculate remaining units on the server, accept zero on individual lines, and commit the receipt, movements and status updates together.
- [x] Reuse a single BO reference per purchase order across repeat deliveries and corrections. Add the BO list, receipt history, printable details and a pending back-order dashboard count.
- [x] Connect Stock Management to live item totals, size breakdowns and movement history.
- [x] Verify the 6-then-4 receipt sequence in isolated tests, including multi-size deliveries, over-receipt rejection, duplicate submissions, concurrent receipts and rollback.

## 5. Add uniform issue, supplier returns and corrections

- [x] Add multi-line uniform issues and supplier returns with stable references and the signed-in actor on each transaction.
- [x] Validate cumulative outbound quantities per size and save with retry protection in one transaction.
- [x] Add searchable issues and returns, printable details, and Cadet Kit issue history with line and unit totals.
- [x] Restrict confirmed order cancellation and stock reversals to administrators. Keep cancellation and reversal reasons in the audit history and recalculate affected stock, order and kit totals.
- [x] Verify issue, return and reversal balance changes, competing issues, insufficient stock, and historical recipient labels in isolated tests.

## 6. Finish account administration and branding

- [x] Add administrator username and role edits and a temporary password reset that revokes prior sessions and requires a password change. Keep Staff Accounts entry to **Username, Password, Role**.
- [x] Add reversible account deactivation with session revocation, preserved operational attribution and last-administrator protection.
- [x] Add system and short names, dashboard About Us, and validated logo and sign-in cover uploads with previews. Store both images in the existing D1 binding.
- [x] Verify administrator access, password resets, session revocation and image replacement failures in isolated tests.

## 7. Reconcile data and verify release

- [ ] Confirm whether to import V1 data and whether routine CSV import or export is required. For an approved V1 import, confirm the CIN mapping and rehearse on isolated data. Reconcile recipient links, size-level balances, open PO/BO quantities and source references before touching production.
- [ ] Review each changed or moved file against Git, including imports, API contracts, auth, D1 bindings and build paths. Preserve the production D1 ID and keep V1 data and configuration out of staging and published assets.
- [ ] Run isolated checks for each changed workflow as appropriate. Keep source review, dependency audit, Cloudflare build and browser verification distinct. Leave build verification to Cloudflare under the current project instructions.
- [ ] Obtain explicit approval for each GitHub push. After deployment, exercise the full order-to-issue flow and access restrictions with test accounts in the browser. Verify that hosting serves only `build/` and allowed public assets.
- [ ] In the deployed browser, also verify register edits, order and stock pickers, both dashboard counts, receipt and issue history, print output and administrator corrections.
- [ ] Establish whether a future workflow needs cadet handbacks, current holdings or a separate supplier-return contact field.
