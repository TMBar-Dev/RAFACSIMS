# RAFACSIMS on Cloudflare

The React frontend and authentication API deploy together as the `rafacsims` Worker. D1 is accessed through the `DB` binding. No MySQL server or Express process is needed.

## Cloudflare Workers Builds settings

- Repository: mbchwedding28/RAFACSIMS, branch main
- Root directory: client
- Build command: npm run build
- Deploy command: npx wrangler deploy

Remove any previous `--assets` command-line argument: client/wrangler.jsonc now configures both the Worker API and assets. The build identity must have permission to deploy Workers and bind the specified D1 database. The database name in the config assumes `rafacsims`; adjust it if you chose another name. The database ID is already configured.

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

The legacy root index.js and server/ files are retained for reference and are not deployed. Use client/wrangler.jsonc, not the old Express server. Cloudflare is responsible for build verification per the requested workflow.
