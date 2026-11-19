# RAFACSIMS on Cloudflare

The React frontend and authentication API deploy together as the `rafacsims` Worker. D1 is accessed through the `DB` binding. No MySQL server or Express process is needed.

## Staff Accounts

Administrators can use `#/staff` to create staff logins with a username, temporary password and role. New staff must change their password on first sign-in. The directory shows username, role and sign-in status, with refresh and pagination at 25 entries per page.

Use **Use an existing login** to add an account to the staff directory by username. Linking preserves the account's credentials and role. Each account can be linked once, and new-login creation saves the account and its staff link in one transaction.

The existing D1 schema requires nonempty name columns, so new staff links use fixed markers there. Existing staff records and order references stay in place. The form and API no longer collect or return profile details. Initialization adds a missing staff link for the existing administrator.

## Management database schema

`schema.js` defines the management tables alongside the existing authentication tables. The first API request after deployment runs the Worker's idempotent initialization and creates missing tables. The existing D1 binding, users, sessions and account passwords carry forward.

| Table | Fields and constraints |
| --- | --- |
| `staff` | `id`; optional unique `user_id` linking an account; optional unique `service_number`; `first_name`, `last_name`, `rank`, `appointment`, `email`, `phone`; `status` of `active` or `inactive`; `created_at`, `updated_at`. |
| `cadets` | `id`; optional unique `service_number`; `first_name`, `last_name`, `rank`, `flight`; optional `date_joined` in `YYYY-MM-DD` form; `status` of `active`, `inactive` or `left`; `created_at`, `updated_at`. |
| `stock` | `id`; unique `reference`; `description`, `category`, `size`; nonnegative integer `quantity` and `reorder_level`; `location`; `created_at`, `updated_at`. |
| `orders` | `id`; unique `order_number`; required `stock_id`; positive integer `quantity`; `order_type` of `issue`, `return` or `restock`; `status` of `draft`, `submitted`, `fulfilled` or `cancelled`; optional `cadet_id`, `staff_id`, `created_by_user_id`; `notes`; `created_at`, `updated_at`. |
| `suppliers` | Unique name, address, contact details and active status. |
| `catalog_items`, `catalog_variants` | Item names are unique per supplier, and sizes are unique per item. Items store description, Blue/Green type and status. Variants have their own status. |
| `purchase_orders`, `purchase_order_lines` | A purchase order has a generated reference, one supplier, remarks, actor, status and version. Lines reference individual size variants and retain the recorded item and size labels. |
| `back_orders`, `purchase_order_cancellations` | One back-order reference per purchase order, and an audit record for cancelling an order before its first receipt. |
| `inventory_transactions`, `stock_movements` | Posted receipts, issues, supplier returns, opening balances and reversals. Each movement records a signed quantity for a variant. Receipt movements also reference the originating purchase-order line. |

Relationships and initial assumptions:

- A staff record may link to one user account; the unique `user_id` prevents multiple staff records linking to the same account. Deleting that account sets the staff link to null rather than deleting the staff record.
- Staff appointment/status fields describe the profile only. Sign-in permissions still come from the existing `users` table; these profile fields do not grant or revoke login access.
- The original `orders` table represents one stock item per row. Its required `stock_id` prevents deletion of referenced stock. Multi-line purchase orders use separate tables so original rows stay available for reconciliation.
- Optional order links identify a cadet, staff member and creating user account. Deleting one of those linked records sets its corresponding order reference to null; it does not delete the order.
- Timestamps are Unix seconds. `updated_at` receives an initial value when a record is created; future write handlers must update it explicitly. There is no automatic timestamp-update trigger.
- Creating or editing a purchase order leaves stock quantities alone. Receiving adds stock when a receipt is posted.

`CREATE TABLE IF NOT EXISTS` initializes missing tables. Changes to existing table definitions require a separate migration.

### Schema change review: 17 November 2026

This historical review covers the initial table definitions, before the later Staff Accounts API/page connection.

Static review completed with no blocking findings. All eight isolated tests passed with zero failures, covering additive/idempotent table setup, record/password preservation, relationships and deletion behavior, quantity/status validation, no automatic stock changes, and the existing account API regressions.

`npm test` runs the root `*.test.mjs` suites, including `schema.test.mjs` and `users-api.test.mjs`. The recorded run used `node --test --test-isolation=none users-api.test.mjs schema.test.mjs`. These checks use isolated test storage and do not access or modify live D1 records. A passing isolated test run does not establish successful Cloudflare deployment or browser behavior. No local frontend build or browser verification has been performed.

## Current pages and templates

After signing in and completing any required password change, the application provides these navigation destinations:

| Page | Application route | Current scope |
| --- | --- | --- |
| Dashboard | `#/dashboard` | Live pending purchase-order and back-order counts for users with operational access. |
| User Management | `#/users` | Create accounts, edit usernames and roles, reset passwords and manage sign-in access. |
| Settings | `#/settings` | Manage the system and short names, logo, sign-in cover and About Us. |
| Cadets | `#/cadets` | Search and view cadets. Administrators can add and edit records, including inactive and left statuses. |
| Suppliers | `#/suppliers` | Administrator-only supplier register and contact maintenance. |
| Item Catalog | `#/catalog` | Administrator-only catalog maintenance. View an item to manage its sizes. |
| Orders | `#/orders` | Search, create, print and edit pending purchase orders. |
| Receiving | `#/receipts` | Post quantities from a PO or BO and view or print receipt history. |
| Back Orders | `#/back-orders` | View remaining quantities, print details and open receiving. |
| Stock Management | `#/stock` | View live item and size balances, movements and any previously posted opening balances. |
| Issue Uniform | `#/issues` | Issue stock to an active cadet and view or print issue history. |
| Supplier Returns | `#/supplier-returns` | Send stock back to a supplier and view or print return history. |
| Cadet Kit | `#/cadet-kit` | View issue history and unreversed issue, line and unit totals by cadet. |
| Staff Accounts | `#/staff` | Working administrator-only staff directory and profile creation with new or existing sign-in accounts. |

The [implementation checklist](TODO.md) tracks account administration, settings and eventual V1 data reconciliation.

Staff Accounts, User Management and Settings require a live administrator session and completion of any mandatory password change. Both navigation and the Worker enforce these access rules.

Operational pages are visible to administrators and ordinary users linked through Staff Accounts. The browser checks operational access when it restores or establishes a session and after a password change. A newly linked user can reload to refresh navigation. The Worker checks D1 on each operational request.

Staff can read active register records and create or edit purchase orders. Administrators can also view retired records and maintain the registers. Catalog items keep their supplier after creation, and existing size variants can be retired or reactivated. Purchase orders retain supplier, item and size labels for historical display. An order keeps its supplier after creation. Pending orders can keep or reduce an existing inactive line, while new lines need an active supplier, item and size.

### Receiving and stock corrections

Receive from a purchase order or its back order. A partial delivery opens a BO reference that stays with the order through later deliveries and reversals. A receipt can leave individual lines at zero if it adds units against at least one line. The Worker validates order balances as the movements commit.

Uniform issues and supplier returns reduce available stock. Cadet Kit counts posted, unreversed issues, and history retains the names recorded at posting. Supplier returns record the signed-in actor. Cadet handbacks and current holdings are outside these issue totals.

Administrators can cancel a pending purchase order with no receiving history, or reverse a posted receipt, issue, supplier return or historical opening balance with a recorded reason. A reversal preserves the original and requires enough available stock for any outbound correction. Historical source rows and movements remain intact. Legacy intake is outside the release scope.

Existing registration, sign-in, session restoration, logout and password-change flows remain the account foundation. Management templates mount only after an authenticated session is restored or established and the account no longer requires its initial password to be changed. The optional password-change form remains available from the signed-in interface.

### User Management

Administrators can use `#/users` to list and manage accounts. Lists contain at most 25 accounts per page and use the returned cursor for the next page.

Account creation requires a unique username of 3–40 letters, numbers, dots, underscores or hyphens, a role of `user` or `admin`, and a temporary password of 12–128 characters entered twice. Administrators can edit a different account's username or role, set a temporary password, or deactivate and reactivate that account. An identity change, password reset or deactivation revokes the target account's active sessions. A reset requires the user to replace the temporary password at the next sign-in.

Deactivation keeps the user ID, staff link and history. Reactivation permits a new login and preserves any pending password-change requirement. Another active administrator who has completed any required password change must perform these actions. The Worker rechecks that administrator's session during the write, so simultaneous actions cannot remove the last ready administrator. Users can change their own passwords through the existing account controls. The bootstrap username `admin` stays reserved.

Creating an account through User Management does not create a staff-profile record. Use Staff Accounts to create a profile with a new login or to link an existing username. Existing public registration remains available and creates ordinary users only.

### Branding

The short name and logo appear in the app bar. The system name is used for the page title and the cover is used behind the sign-in screen. About Us appears as plain text on the signed-in dashboard.

The built-in identity uses the carton mark in `favicon.ico`, `apple-touch-icon.png`, `app-icon-192.png` and `app-icon-512.png`. The browser manifest and Settings preview use the same icon artwork. The bundled `stores-cover.jpg` is the default sign-in cover. Saved logos and covers take precedence in the app.

The cover was created with the built-in ImageGen tool and saved as an optimised JPEG. The generation prompt was:

> Photorealistic editorial cover photograph for a modern RAF Air Cadets squadron stores inventory web app. Wide landscape image, a tidy stack of folded plain RAF-blue shirts and dark navy uniform knitwear beside a pair of polished black parade boots on a light utilitarian shelf. Keep the objects grouped to the LEFT with comfortable framing and generous quiet dark slate-blue negative space on the RIGHT for an overlaid sign-in card. Use natural side light, tactile fabric and leather, subtle grain, dark ink-blue and desaturated blue-grey palette. A contemporary product photograph, grounded and recognisably about uniform stores. No people, insignia, logos, badges, weapons, aircraft, lettering or watermarks. No UI in the image.

The app stores two image slots in the existing D1 binding. The logo accepts PNG or JPEG up to 128 KiB and 1,024 pixels per side. The cover accepts PNG or JPEG up to 512 KiB and 2,560 pixels per side. The Worker validates the image structure and dimensions before replacing a saved slot. Uploads are served only from the two branding image endpoints. [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

### Page and User Management change review: 17 November 2026

This historical review covers the template/User Management work before the later Staff Accounts connection.

This change adds navigation, four clearly labelled templates and live administrator-only user listing/creation. Existing registration, login, session restoration, logout and password-change flows must retain their current contracts. User Management reuses the existing users table; no database replacement, account import or existing-password reset is required.

Source review is complete. All five isolated SQLite API tests passed with zero failures, covering administrator/ordinary-user/first-login permission gates, account validation and creation, safe cursor pagination, and existing login/logout/password-change behavior. The tests use real password hashing against in-memory test storage; no live D1 records were accessed or changed.

At the time of this review, `npm test` ran `users-api.test.mjs`. In a sandbox that blocks test-runner child processes, use `node --test --test-isolation=none users-api.test.mjs`; this was the command used for the recorded passing run. The current test script also includes the later schema suite described above. These API tests do not build the frontend or establish browser/Cloudflare compatibility. No local frontend build or browser verification has been performed. After deployment, check all existing account flows, role restrictions, list pagination and creation followed by mandatory first-login password change.

Dependencies and D1/deployment configuration are unchanged. The Worker gains only the account-management endpoints described below; the frontend adds `users.jsx` and navigation to it. The existing template source comparison below applies to the template-only work before User Management was added, not proof that the new API has been verified.

### Earlier template-only source review: 17 November 2026

The intended change is to replace the signed-in welcome-only screen with navigation and clearly labelled management templates. Existing account requests and responses, credentials, cookie handling and mandatory password-change enforcement must be preserved. Dependencies, the Worker API, D1 configuration and deployment configuration are outside the scope of this template change.

Static source review is complete. The API helper and existing session/account handlers exactly match the preceding commit (`f94c7db`). The Worker, D1 settings, dependencies and build configuration are unchanged.

| Changed file | Review result |
| --- | --- |
| `main.jsx` | Adds navigation and replaces the signed-in welcome panel with a workspace. Existing account handlers are preserved. Session loading and required password changes still gate the workspace, including direct hash links. |
| `templates.jsx` | Defines the four routes and reusable layouts. Staff visibility is administrator-only. Tables have explicit empty states; all record controls are disabled and no management API/storage operations are added. |
| `App.css` | Adds responsive workspace, navigation and table styles, plus the Roboto font for page text. Existing account forms and their background remain. |
| `README.md` | Records available routes, template limitations and this review. The historical consolidation review below is retained with its original scope. |

Unknown hash routes fall back to Dashboard. Browser hash navigation updates the active page without a full reload. No new dependencies were added.

Build and browser verification have not been performed locally; the agreed workflow leaves the build to Cloudflare. After deployment, check navigation, page reload/back navigation, ordinary-user versus administrator visibility, and all existing account flows before treating the templates as runtime-verified.

## Folder-consolidation behaviour review: 17 November 2026

**Result: no functionality loss found in the source comparison. Cloudflare build and browser verification of the flattened layout are still pending.**

This historical review covers the folder consolidation only. Its source-equivalence findings do not establish verification of the later page-template changes described above.

Every application file was compared with its previous location in commit `9a18666`, before the client/worker folders were merged into this top-level layout. The comparison covered executable code, static assets, dependency records and deployment paths. Explanatory comments were then added and reviewed separately.

| Files | Review result |
| --- | --- |
| `main.jsx` | All 115 ordered non-comment/nonblank lines match the previous React entry file. Registration, sign-in, session restoration, logout and both password-change forms retain their existing logic. |
| `worker.js` | All 168 ordered non-comment/nonblank lines match the previous Worker. API contracts, password hashing, cookie settings, session expiry/revocation, rate limiting and first-login restrictions are unchanged. |
| `App.css` | Only the background image path and explanatory comments changed. Styles and layout are preserved. |
| `build.mjs` | Entry and metadata paths now point to root files. The previous public-directory copy is replaced by an explicit list of the same three public files. Bundle options, CSS/font handling and content hashes are preserved. |
| `index.html` | HTML and build insertion markers are preserved; an explanatory comment was added. |
| `wrangler.jsonc` | The Worker entry path is updated. D1 database ID, binding, static output directory and API routing are unchanged. Comments explain their purpose. |
| `package.json`, `package-lock.json` | Only package-name metadata changed. The resolved dependency tree is unchanged from the audited version, which reported zero known vulnerabilities, including development dependencies. |
| `bg.jpg`, `favicon.ico` | Binary Git hashes match the previous files. |
| `manifest.json`, `robots.txt` | Content is preserved; only line endings changed during the move. |
| `.gitignore`, `README.md`, `AGENTS.md` | Ignore patterns and documentation reflect the single-level layout. Project instructions require functionality review, useful comments and explicit push approval. |

The D1 schema and initialization logic are unchanged. Existing accounts and changed admin passwords are preserved by the same insert-if-missing behavior; this layout change introduces no database migration or password reset.

Syntax, JSON/configuration and path checks passed. These checks establish source consistency, not full runtime equivalence. No local build or browser tests were run, following the agreed Cloudflare verification workflow.

Before marking this layout verified in production:

1. Change Cloudflare's root directory from `client` to the repository root, then confirm its build and deployment succeed.
2. Register an ordinary account and sign in; confirm validation and incorrect-password messages still work.
3. Reload to check session restoration, then log out and confirm protected requests no longer accept that session.
4. Change a password; confirm the old password and prior sessions stop working and the new password works.
5. On a separate fresh test database, check that the seeded admin must change its initial password and that redeployment preserves the replacement. Do not reset the live database or live admin account for this test.

## Cloudflare Workers Builds settings

- Repository: mbchwedding28/RAFACSIMS, branch main
- Root directory: repository root (clear the previous client setting; use / if Cloudflare requires a value)
- Build command: npm run build
- Deploy command: npx wrangler deploy

Remove any previous `--assets` command-line argument: wrangler.jsonc configures both the Worker API and assets. The build identity must have permission to deploy Workers and bind the specified D1 database. The database name in the config assumes `rafacsims`; adjust it if you chose another name. The database ID is already configured.

The first API request after deployment creates missing authentication and management tables. Keep the deployed D1 binding and existing administrator accounts. A fresh D1 database needs a deployment-controlled administrator secret as described below.

## First sign-in

For a fresh D1 database or an untouched account that still uses the retired public credential, configure `ADMIN_BOOTSTRAP_PASSWORD` as a Cloudflare Worker secret with a unique password of 16–128 characters. Sign in as `admin` using the secret's value and complete the required password change. After verifying the new sign-in, remove the deployment secret. Redeploying preserves passwords already changed by the administrator. Accounts still using the retired credential and sessions tied to it are blocked until the account is provisioned.

Public registration creates ordinary users, never administrators. Sessions use random tokens, stored hashed in D1, in Secure/HttpOnly/SameSite cookies with a 24-hour expiry. Password changes invalidate all prior sessions and issue a fresh token. API responses return only explicitly allowed account fields; password hashes and session tokens are never returned in response bodies.

The local `V1/` copy is reference material. Importing legacy accounts or operational data requires separate reconciliation.

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

The unused Express/MySQL backend and its duplicate dependency manifests have been removed. All application files are in the repository root, with a single package.json and package-lock.json. The Worker uses platform APIs without npm dependencies.

## Files

- main.jsx and App.css: React interface and styling.
- templates.jsx: Dashboard and navigation definitions.
- registers.jsx, purchase-orders.jsx and management-ui.jsx: live register and purchase-order screens and shared search and picker components.
- users.jsx and account-admin.js support administrator account listing, creation, editing, resets and access controls.
- settings.jsx and branding.js support administrator branding and the public image endpoints.
- staff.jsx: live staff profile listing and creation with new or existing login accounts.
- worker.js and management.js: authentication, D1 initialization and operational API handlers.
- inventory.js and inventory-schema.js: receipt, back-order, stock and correction APIs and storage.
- inventory-transactions.jsx, inventory-pages.jsx and inventory-ui.jsx: receiving, stock, issue, return and Cadet Kit screens.
- schema.js: management table definitions, constraints and relationships used during Worker initialization.
- schema.test.mjs: isolated SQLite tests for the management schema; no live D1 writes.
- users-api.test.mjs: isolated SQLite-backed API checks, invoked with npm test; not a live D1 or frontend/browser test.
- staff-api.test.mjs: isolated checks for staff permissions, account linking/creation and admin-profile preservation; not a live D1 or frontend/browser test.
- index.html: HTML template used by build.mjs.
- favicon.ico, apple-touch-icon.png, app-icon-192.png, app-icon-512.png, manifest.json and robots.txt are copied as public assets. The sign-in cover is bundled separately from stores-cover.jpg.
- build.mjs: builds the frontend into build/ and copies only the explicitly listed public files.
- wrangler.jsonc: deploys worker.js and build/ together.
- package.json and package-lock.json: dependencies and npm commands.
- AGENTS.md: preservation, documentation, verification and push requirements for code changes.

Generated build/, node_modules/ and .wrangler/ directories are ignored by Git. The repository root itself is never served as a public assets directory.

## Frontend tooling

The frontend uses esbuild for JSX, JavaScript, CSS, font and image bundling. Run npm commands from the repository root. Node.js 22.12+ is required; the Cloudflare Node 24 environment satisfies this. Generate lockfile updates with npm 10.9.2 to match Cloudflare's installer.

The build writes assets to build/. index.html is the HTML template and main.jsx contains the React entry point and interface. JavaScript, CSS, fonts and images use content hashes for cache updates. The build script generates the HTML bundle references automatically. When upgrading from the former client/ layout, change Cloudflare's root directory to the repository root before deploying.

React Scripts, unused Axios, test helpers, icons and web-vitals have been removed. The Roboto imports use the maintained @fontsource/roboto package. Material UI remains on v4 to preserve the current interface; its deprecation is separate from npm audit findings. The build uses esbuild directly to avoid additional build dependencies with unpatched advisories.

npm start (or npm run dev) serves a frontend-only development preview on 127.0.0.1:5173. It does not emulate the Worker or D1, so authentication requires the deployed Cloudflare application. After editing favicon.ico, manifest.json, robots.txt or index.html, restart the preview to pick up those changes.

Use npm audit --package-lock-only to inspect both production and development dependencies. Do not use npm audit fix --force to replace the build system with an incompatible placeholder version. Cloudflare is responsible for build verification per the requested workflow.

## Functionality review

Every changed or moved file must be reviewed against the previous Git version. Check frontend state/forms, API requests and responses, session cookies, password-change enforcement, D1 identifiers, static asset paths and deployment configuration. Comments explain the non-obvious behavior in main.jsx, worker.js, build.mjs and wrangler.jsonc. JSON manifests and the generated lockfile are documented here instead of containing comments.

package.json pins the browser dependencies (React, ReactDOM, Material UI and Roboto) and esbuild as the build dependency. package-lock.json records their resolved versions and integrity hashes; regenerate it using npm 10.9.2 rather than editing dependency records by hand. manifest.json describes the browser's app name, launch URL, colours and home-screen icons. robots.txt currently permits crawler access; it is not an authorization mechanism.

The dated review sections above separate the folder-consolidation comparison from the later template changes. Update each with its actual static, deployment and browser-verification results when those checks have been completed; do not carry a prior change's verification forward as proof for a new change.
