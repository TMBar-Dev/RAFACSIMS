# RAFACSIMS

RAFACSIMS, called CAT SIMS in the design documents, is a squadron stores application for the RAF Air Cadets. It tracks uniform stock from supplier orders and deliveries through issue to cadets, returns to suppliers and stock corrections.

The project rebuilds the workflows of the SIS V1 PHP/MySQL reference as a React application backed by Cloudflare Workers and D1. The local `V1/` copy and its SQL exports informed the design and are excluded from Git and deployment. This release starts with fresh operational records. Legacy migration, CSV exchange, cadet handbacks and current holdings are outside its scope.

- [Design and business rules](DESIGN.md)
- [Release checklist and development priorities](TODO.md)
- [Repository and post-push requirements](AGENTS.md)

## Stores workflows

1. Administrators set up suppliers, cadets, catalog items and sizes. Staff account creation uses **Username**, **Password** and **Role**. Administrators can also link an existing login.
2. Staff or administrators raise a purchase order for one supplier. Receiving stock updates the size balances. A partial delivery creates a back order for the remainder, and later deliveries close the same back order.
3. Staff or administrators issue stock to a cadet or return stock to a supplier. Stock Management shows availability and movement history by size. Cadet Kit shows issue history and totals for unreversed issues.
4. Administrators can cancel eligible unreceived orders or reverse posted movements with a reason. The originals and the corrections remain available in history. Transaction details support printing.

The dashboard links operational users to outstanding purchase orders and back orders. About Us is shown after sign-in and any required password change.

| Access | Capabilities |
| --- | --- |
| Administrator | Stores workflows, register maintenance, Staff Accounts, User Management, branding, cancellations and stock reversals. |
| Linked staff | Stores workflows and active register lookups. |
| Unlinked user | Basic dashboard and account controls. Public registration creates this level of access. |
| Password change required | Account controls until the temporary password is replaced. |

Deactivation blocks sign-in and preserves historical attribution. The Worker checks permissions for each protected API request.

## Architecture and repository layout

The source lives at the repository root. React 17 and Material UI 4 provide the interface. esbuild bundles scripts, styles, fonts and imported images into `build/` with content-hashed filenames. Wrangler deploys the Worker and the static assets together. Requests to `/api/*` reach the Worker first. Other paths use the asset binding and the single-page application fallback.

| Area | Files |
| --- | --- |
| Browser entry, styles and navigation | `index.html`, `main.jsx`, `App.css`, `templates.jsx` |
| Registers and orders | `registers.jsx`, `purchase-orders.jsx`, `management-ui.jsx`, `management.js`, `schema.js` |
| Inventory and ledger | `inventory-transactions.jsx`, `inventory-pages.jsx`, `inventory-ui.jsx`, `inventory.js`, `inventory-schema.js` |
| Accounts and branding | `staff.jsx`, `users.jsx`, `settings.jsx`, `account-admin.js`, `branding.js` |
| Authentication and deployment | `worker.js`, `wrangler.jsonc`, `build.mjs`, `package.json`, `package-lock.json` |

The Worker initializes missing tables on API access. Keep the existing `DB` binding and D1 database ID to preserve accounts and operational records. Stock availability comes from posted movements. Database constraints and batched writes protect stock and order remainders. Request IDs support recovery when a posting response is interrupted.

## Cloudflare deployment

| Workers Builds setting | Value |
| --- | --- |
| Repository and branch | `mbchwedding28/RAFACSIMS`, `main` |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Worker and D1 database name | `rafacsims` |

Set the build root to the repository root in place of the former `client/` directory. Use the asset binding in `wrangler.jsonc` without a separate `--assets` argument. The deploy identity needs access to the Worker and its configured D1 database. The public asset allowlist includes the favicon, Apple touch icon, two app icons, manifest and robots file alongside the bundled app. Keep source, SQL exports, secrets and `V1/` outside the published directory.

### First sign-in

For a fresh database or a reserved `admin` account still on the retired credential, set the Worker secret `ADMIN_BOOTSTRAP_PASSWORD` to a unique password of 16–128 characters. Sign in as `admin`, complete the required password change, verify the new sign-in and remove the secret. Existing changed passwords survive redeployment.

Sessions expire after 24 hours and use Secure, HttpOnly, SameSite cookies with hashed tokens in D1. Password changes revoke prior sessions. Administrator username or role changes, resets and deactivation revoke affected sessions.

### Weekly and post-push deployment

Manage the Monday 03:00 UTC schedule under **Trigger Events** on the existing Worker. Omit a cron declaration from `wrangler.jsonc` to leave the schedule under dashboard management. The scheduled handler reads the runtime secret `CLOUDFLARE_DEPLOY_HOOK_URL` and requests a rebuild of `main` even when the branch has no new commits. The scheduled hook value is kept locally in the ignored `.env.cloudflare-nightly-deploy-hook` file. Verify the trigger, secret and acknowledged build ID in Workers Logs, then check the deployment result in Workers Builds. A rebuild uses the current branch, so code defects still require a fix or rollback.

The separate post-push hook uses the ignored `.env.cloudflare-deploy-hook` file. Follow [AGENTS.md](AGENTS.md) for approval and reporting. A queued build confirms acceptance of the request. Confirm deployment separately.

## Branding

Administrators can change the system name, short name, About Us, app-bar logo and sign-in cover. The logo accepts PNG or JPEG up to 128 KiB and 1,024 pixels per side. The cover accepts the same formats up to 512 KiB and 2,560 pixels per side. The Worker validates uploaded bytes before replacing saved images. Browser and home-screen icons use the bundled carton artwork. The default sign-in cover is the ImageGen-produced `stores-cover.jpg`.

## API

- GET /api/session
- GET /api/operations/access returns `{ "canOperate": true }` to an administrator or linked staff user who has completed any required password change. Signed-out requests receive 401. Other ineligible sessions receive 403.
- POST /api/register: username, password
- POST /api/login: username, password
- POST /api/change-password: currentPassword, newPassword
- POST /api/logout
- GET /api/users?after=0 returns up to 25 accounts with ID, username, role, active status, password-change status and creation time. Use the returned cursor for the next page.
- POST /api/users: administrator-only creation with `username`, `password` and `role`; the created account must change its password on first login.
- POST /api/users/ID/edit accepts `username`, `role`, `previousUsername` and `previousRole`. POST /api/users/ID/reset-password accepts `password`. POST /api/users/ID/deactivate and /api/users/ID/reactivate accept an empty JSON object.
- GET /api/staff?after=0 returns up to 25 entries ordered by staff ID, along with the next cursor or null. Each entry contains its staff ID and an account with ID, username, role, active status and password-change status. Unlinked entries have a null account.
- POST /api/staff creates a staff login from username, password and role. To link an existing login, send username and accountMode set to existing. The response contains a confirmation message.
- GET /api/branding and /api/branding/{logo,cover} provide the public display metadata and images. GET /api/about requires a ready signed-in account.
- GET and POST /api/settings are administrator-only. POST accepts `name`, `shortName` and `aboutUs`. POST /api/branding/{logo,cover} accepts base64 `content` or `restore: true` with the previous `revision`. The browser can fall back to a previous image if a replacement fails to render.

Staff Accounts and User Management endpoints require an authenticated administrator who has completed any mandatory password change. Administrator writes use the same-origin JSON checks and are rate limited.

- `GET /api/{cadets,suppliers,catalog,variants,purchase-orders}` returns up to 25 `records` and a `nextCursor`. Use `q` for search and `after` for the next page. Append `/ID` to get an individual `record`. Register lists support `active=1` for pickers. Catalog and variants support `supplierId`, and variants also support `itemId`.
- `POST /api/{cadets,suppliers,catalog,variants}` creates a record. Append `/ID` to edit it, supplying the `version` obtained from that record's detail. A stale version returns a conflict. Writes require an administrator.
- `POST /api/purchase-orders` creates an order with `supplierId`, optional `notes` and 1–50 `lines`. Each line has `variantId` and a positive whole `quantity` up to 1,000,000. A caller can reuse its `requestId` to recover the original reference if the create response is lost. Append `/ID` and supply the current `version` when editing a pending order.
- `GET /api/purchase-orders/summary` returns `pending`, the count of orders awaiting all or part of their delivery.
- `GET /api/{receipts,back-orders,issues,supplier-returns,cadet-kit,inventory-stock}` provides searchable lists and `/ID` details. Back orders also expose `/summary`. Stock item details expose `/ID/sizes` and `/ID/movements`. For filtered history use `orderId` on receipts or `cadetId` on issues.
- `POST /api/receipts` accepts `orderId`, optional `backOrderId`, optional `notes` and lines with `orderLineId` and `quantity`. `POST /api/issues` or `POST /api/supplier-returns` accepts `cadetId` or `supplierId`, optional `notes` and lines with `variantId` and `quantity`. Reusing the same `requestId` with the same transaction data returns the original reference.
- `GET /api/posting-status/{purchase-orders,receipts,issues,supplier-returns}/REQUEST_ID` returns the original reference to its author after an interrupted save. The browser keeps only a pending request ID in the current tab while the outcome is uncertain.
- Administrators can POST `reason` to `/api/purchase-orders/ID/cancel` or to `/api/{receipts,issues,supplier-returns,opening-balances}/ID/reverse`. The administrator GET endpoint `/api/opening-balances` lists previously posted opening balances.

Management writes share a per-IP rate limit separate from authentication and account maintenance. The isolated API suite covers register and order conflicts, posting recovery, D1 stock invariants, opening-balance reversals, administrator provisioning and branding rollback. Cloudflare build and browser verification cover the remaining integration checks.

JSON POST requests must include a matching Origin header (automatically sent by the browser). All API responses are private/no-store. Password hashing uses Workers Web Crypto PBKDF2 with 100,000 iterations for runtime compatibility. Authentication requests are rate limited by source IP using D1. Expired rate-limit buckets and sessions are removed opportunistically.

## Development and verification

Use Node.js 22.12 or later and npm 10.9.2 from the repository root. Regenerate the lockfile with that npm version when changing dependencies. `npm run dev` provides a frontend-only preview at `127.0.0.1:5173`. Use the deployed app for Worker and D1 workflows. Restart the preview after changing the HTML template or copied public assets.

- `npm test` runs the Node.js SQLite-backed schema and API tests without writing to live D1. If the shell blocks child processes, use `node --test --test-isolation=none *.test.mjs` on Node 24.
- `npm audit --package-lock-only` checks dependency advisories without installing packages.
- Cloudflare Workers Builds performs build verification. Use fresh records in the deployed browser to verify the real Worker, D1 and UI together.
- Record source review, dependency audit, Cloudflare build and browser verification separately. See the [release checklist](TODO.md).

## Development focus

Complete owner-led release verification first, including the Monday deployment and a full stores workflow through stock correction. Use pilot feedback to prioritize navigation, forms, interrupted saves and printing. Document D1 recovery and monitoring, then plan the React and Material UI upgrade separately from feature work. See the [prioritized backlog](TODO.md#development-after-release-verification).

<details>
<summary>Default cover generation prompt</summary>

> Photorealistic editorial cover photograph for a modern RAF Air Cadets squadron stores inventory web app. Wide landscape image, a tidy stack of folded plain RAF-blue shirts and dark navy uniform knitwear beside a pair of polished black parade boots on a light utilitarian shelf. Keep the objects grouped to the LEFT with comfortable framing and generous quiet dark slate-blue negative space on the RIGHT for an overlaid sign-in card. Use natural side light, tactile fabric and leather, subtle grain, dark ink-blue and desaturated blue-grey palette. A contemporary product photograph, grounded and recognisably about uniform stores. No people, insignia, logos, badges, weapons, aircraft, lettering or watermarks. No UI in the image.

</details>
