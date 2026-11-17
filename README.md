# RAFACSIMS on Cloudflare

The React frontend and authentication API deploy together as the `rafacsims` Worker. D1 is accessed through the `DB` binding. No MySQL server or Express process is needed.

## Behaviour review: 17 November 2026

**Result: no functionality loss found in the source comparison. Cloudflare build and browser verification of the flattened layout are still pending.**

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

The first API request creates the users/sessions tables and inserts admin only if the account does not already exist. No manual SQL or separate migration command is required for this initial version. D1 must already exist; this code does not create the Cloudflare database resource.

## First sign-in

Username: admin
Initial password: RAFACSIMS

Sign in immediately after deployment and replace the initial password. The API restricts this session to password changes, session inspection and logout until the password is changed. A new password must contain 12–128 characters. The initial password is stored as a salted PBKDF2-SHA256 hash, not plaintext. Redeployments never reset an existing admin password. This initial credential is publicly known; whoever signs in first can claim the admin account.

Registration creates ordinary users, never administrators. Sessions use random tokens, stored hashed in D1, in Secure/HttpOnly/SameSite cookies with a 24-hour expiry. Password changes invalidate all prior sessions and issue a fresh token. User records and password hashes are never returned by the API.

This is the authentication foundation. Cadet, stock and staff management functionality has not yet been implemented. No existing MySQL account export was available, so existing accounts are not imported.

## API

- GET /api/session
- POST /api/register: username, password
- POST /api/login: username, password
- POST /api/change-password: currentPassword, newPassword
- POST /api/logout

JSON POST requests must include a matching Origin header (automatically sent by the browser). All API responses are private/no-store. Password hashing uses Workers Web Crypto PBKDF2 with 100,000 iterations for runtime compatibility. Authentication requests are rate limited by source IP using D1. Expired rate-limit buckets and sessions are removed opportunistically.

The unused Express/MySQL backend and its duplicate dependency manifests have been removed. All application files are in the repository root, with a single package.json and package-lock.json. The Worker uses platform APIs without npm dependencies.

## Files

- main.jsx and App.css: React interface and styling.
- worker.js: authentication API, sessions and D1 table setup.
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

The dated behaviour-review report above records the comparison results and remaining deployment/browser checks for the top-level layout. Update it with the outcome when those checks have actually been completed.
