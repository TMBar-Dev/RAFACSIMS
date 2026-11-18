# RAFACSIMS on Cloudflare

The React frontend and authentication API deploy together as the `rafacsims` Worker. D1 is accessed through the `DB` binding. No MySQL server or Express process is needed.

## Staff Accounts

Administrators can use `#/staff` to create staff logins with a username, temporary password and role. New staff must change their password on first sign-in. The directory shows username, role and password status, with refresh and pagination at 25 entries per page.

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

Relationships and initial assumptions:

- A staff record may link to one user account; the unique `user_id` prevents multiple staff records linking to the same account. Deleting that account sets the staff link to null rather than deleting the staff record.
- Staff appointment/status fields describe the profile only. Sign-in permissions still come from the existing `users` table; these profile fields do not grant or revoke login access.
- The original `orders` table represents one stock item per row. Its required `stock_id` prevents deletion of referenced stock. Multi-line purchase orders use separate tables so original rows stay available for reconciliation.
- Optional order links identify a cadet, staff member and creating user account. Deleting one of those linked records sets its corresponding order reference to null; it does not delete the order.
- Timestamps are Unix seconds. `updated_at` receives an initial value when a record is created; future write handlers must update it explicitly. There is no automatic timestamp-update trigger.
- Creating or editing a purchase order leaves stock quantities alone. Receiving will post stock movements.

`CREATE TABLE IF NOT EXISTS` initializes missing tables. Changes to existing table definitions require a separate migration.

### Schema change review: 17 November 2026

This historical review covers the initial table definitions, before the later Staff Accounts API/page connection.

Static review completed with no blocking findings. All eight isolated tests passed with zero failures, covering additive/idempotent table setup, record/password preservation, relationships and deletion behavior, quantity/status validation, no automatic stock changes, and the existing account API regressions.

`npm test` runs the root `*.test.mjs` suites, including `schema.test.mjs` and `users-api.test.mjs`. The recorded run used `node --test --test-isolation=none users-api.test.mjs schema.test.mjs`. These checks use isolated test storage and do not access or modify live D1 records. A passing isolated test run does not establish successful Cloudflare deployment or browser behavior. No local frontend build or browser verification has been performed.

## Current pages and templates

After signing in and completing any required password change, the application provides these navigation destinations:

| Page | Application route | Current scope |
| --- | --- | --- |
| Dashboard | `#/dashboard` | Live pending purchase-order count for users with operational access. |
| User Management | `#/users` | Working administrator-only account list and account creation, backed by the existing D1 users table. |
| Cadets | `#/cadets` | Search and view cadets. Administrators can add and edit records, including inactive and left statuses. |
| Suppliers | `#/suppliers` | Administrator-only supplier register and contact maintenance. |
| Item Catalog | `#/catalog` | Administrator-only catalog maintenance. View an item to manage its sizes. |
| Orders | `#/orders` | Search, create, print and edit pending purchase orders. |
| Stock Management | `#/stock` | Stock register layout, proposed columns and empty-state guidance. |
| Staff Accounts | `#/staff` | Working administrator-only staff directory and profile creation with new or existing sign-in accounts. |

Stock Management remains a template until receiving and stock movements are implemented. The [implementation checklist](TODO.md) tracks those workflows and the eventual V1 data reconciliation.

Staff Accounts and User Management navigation are restricted to the administrator view. This frontend visibility rule is not an authorization boundary: both APIs independently require a live administrator session and completion of any mandatory password change before they return records or create accounts.

Cadets, Orders and Stock Management are visible to administrators and ordinary users linked through Staff Accounts. The browser checks operational access when it restores or establishes a session and after a password change. A newly linked user can reload to refresh navigation. The Worker checks D1 on each operational request.

Staff can read active register records and create or edit purchase orders. Administrators can also view retired records and maintain the registers. Catalog items keep their supplier after creation, and existing size variants can be retired or reactivated. Purchase orders retain supplier, item and size labels for historical display. An order keeps its supplier after creation. Pending orders can keep or reduce an existing inactive line, while new lines need an active supplier, item and size.

Existing registration, sign-in, session restoration, logout and password-change flows remain the account foundation. Management templates mount only after an authenticated session is restored or established and the account no longer requires its initial password to be changed. The optional password-change form remains available from the signed-in interface.

### User Management

Administrators can open `#/users` to list real accounts, refresh the list, move between pages and create a new ordinary user or administrator. Lists contain at most 25 accounts per page and use the returned cursor for the next page; the interface retains previous cursors for Previous navigation.

Account creation requires a unique username of 3–40 letters, numbers, dots, underscores or hyphens, a role of `user` or `admin`, and a temporary password of 12–128 characters entered twice. Every account created this way must change that temporary password on its first login. Existing account passwords are not reset. Editing roles, deleting accounts and resetting existing passwords are not implemented by this feature.

Creating an account through User Management does not create a staff-profile record. Use Staff Accounts to create a profile with a new login or to link an existing username. Existing public registration remains available and creates ordinary users only.

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

The first API request after deployment creates any missing authentication and management tables, inserts admin only if the account does not already exist, and adds a missing staff link for that account. Existing admin passwords and linked staff profiles are preserved. No manual SQL or separate migration command is required for these initial table definitions. D1 must already exist; this code does not create the Cloudflare database resource.

## First sign-in

Username: admin
Initial password: RAFACSIMS

Sign in immediately after deployment and replace the initial password. The API restricts this session to password changes, session inspection and logout until the password is changed. A new password must contain 12–128 characters. The initial password is stored as a salted PBKDF2-SHA256 hash, not plaintext. Redeployments never reset an existing admin password. This initial credential is publicly known; whoever signs in first can claim the admin account.

Public registration creates ordinary users, never administrators. Sessions use random tokens, stored hashed in D1, in Secure/HttpOnly/SameSite cookies with a 24-hour expiry. Password changes invalidate all prior sessions and issue a fresh token. API responses return only explicitly allowed account fields; password hashes and session tokens are never returned in response bodies.

The local `V1/` copy is reference material. Importing legacy accounts or operational data requires separate reconciliation.

## API

- GET /api/session
- GET /api/operations/access returns `{ "canOperate": true }` to an administrator or linked staff user who has completed any required password change. Signed-out requests receive 401. Other ineligible sessions receive 403.
- POST /api/register: username, password
- POST /api/login: username, password
- POST /api/change-password: currentPassword, newPassword
- POST /api/logout
- GET /api/users?after=0: administrator-only list of up to 25 accounts. `after` is a nonnegative ID cursor. Returns `users` with `id`, `username`, `role`, `mustChangePassword` and `createdAt`, plus `nextCursor` or null.
- POST /api/users: administrator-only creation with `username`, `password` and `role`; the created account must change its password on first login.
- GET /api/staff?after=0 returns up to 25 entries ordered by staff ID, along with the next cursor or null. Each entry contains its staff ID and an account with ID, username, role and password-change status. Unlinked entries have a null account.
- POST /api/staff creates a staff login from username, password and role. To link an existing login, send username and accountMode set to existing. The response contains a confirmation message.

Both Staff Accounts endpoints and both User Management endpoints require an authenticated administrator who has completed any mandatory password change. The existing same-origin JSON checks and write-request rate limit also apply to account/profile creation.

- `GET /api/{cadets,suppliers,catalog,variants,purchase-orders}` returns up to 25 `records` and a `nextCursor`. Use `q` for search and `after` for the next page. Append `/ID` to get an individual `record`. Register lists support `active=1` for pickers. Catalog and variants support `supplierId`, and variants also support `itemId`.
- `POST /api/{cadets,suppliers,catalog,variants}` creates a record. Append `/ID` to update one. Writes require an administrator and use the fields in the corresponding register.
- `POST /api/purchase-orders` creates an order with `supplierId`, optional `notes` and 1–50 `lines`. Each line has `variantId` and a positive whole `quantity` up to 1,000,000. A caller can reuse its `requestId` to recover the original reference if the create response is lost. Append `/ID` and supply the current `version` when editing a pending order.
- `GET /api/purchase-orders/summary` returns `pending`, the count of orders awaiting all or part of their delivery.

Management writes share a per-IP rate limit separate from authentication and account maintenance. The isolated API suite covers permissions, register search and pagination, duplicate and inactive records, multi-size orders, rollback, repeat creates, stale edits and unchanged stock. Cloudflare build and browser verification cover the remaining integration checks.

JSON POST requests must include a matching Origin header (automatically sent by the browser). All API responses are private/no-store. Password hashing uses Workers Web Crypto PBKDF2 with 100,000 iterations for runtime compatibility. Authentication requests are rate limited by source IP using D1. Expired rate-limit buckets and sessions are removed opportunistically.

The unused Express/MySQL backend and its duplicate dependency manifests have been removed. All application files are in the repository root, with a single package.json and package-lock.json. The Worker uses platform APIs without npm dependencies.

## Files

- main.jsx and App.css: React interface and styling.
- templates.jsx: Dashboard, navigation definitions and the Stock Management template.
- registers.jsx, purchase-orders.jsx and management-ui.jsx: live register and purchase-order screens and shared search and picker components.
- users.jsx: live administrator account listing, pagination and account creation.
- staff.jsx: live staff profile listing and creation with new or existing login accounts.
- worker.js and management.js: authentication, D1 initialization and operational API handlers.
- schema.js: management table definitions, constraints and relationships used during Worker initialization.
- schema.test.mjs: isolated SQLite tests for the management schema; no live D1 writes.
- users-api.test.mjs: isolated SQLite-backed API checks, invoked with npm test; not a live D1 or frontend/browser test.
- staff-api.test.mjs: isolated checks for staff permissions, account linking/creation and admin-profile preservation; not a live D1 or frontend/browser test.
- index.html: HTML template used by build.mjs.
- bg.jpg, favicon.ico, manifest.json and robots.txt: public assets.
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

package.json pins the browser dependencies (React, ReactDOM, Material UI and Roboto) and esbuild as the build dependency. package-lock.json records their resolved versions and integrity hashes; regenerate it using npm 10.9.2 rather than editing dependency records by hand. manifest.json describes the browser's app name, launch URL and favicon. robots.txt currently permits crawler access; it is not an authorization mechanism.

The dated review sections above separate the folder-consolidation comparison from the later template changes. Update each with its actual static, deployment and browser-verification results when those checks have been completed; do not carry a prior change's verification forward as proof for a new change.
