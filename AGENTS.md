# Change requirements

- Preserve existing functionality unless the user explicitly requests a behavior change. Review every changed or moved file against the previous Git version, including imports, assets, API contracts, authentication, database bindings and build paths.
- Explain non-obvious flows and assumptions in code comments. Keep comments accurate when code changes. For JSON and generated lockfiles, put explanations in README.md instead of adding invalid comments or editing generated content manually.
- Distinguish source review, dependency audit, successful build and browser/runtime verification. Do not claim unchanged runtime behavior based only on a static comparison.
- The current workflow leaves build verification to Cloudflare. Do not install dependencies or run local builds unless the user changes that preference. Read-only dependency audits and static/syntax checks are allowed.
- Keep frontend/backend source in the single top-level layout. Publish only build/ and explicitly allowed static assets; never expose the repository root as a static directory.
- Preserve the existing D1 database ID, account passwords and session behavior when making unrelated changes.
- Ask for explicit approval before each GitHub push. A previous push approval does not authorize a later push. Prepare a concrete, reviewable change before requesting approval, and identify any remaining functionality or deployment risk.

## After a successful push

- After pushing an approved change to `origin/main`, confirm the remote tip and read its latest commit message. Send a bodyless HTTP POST to the Cloudflare Workers Builds hook configured in the ignored local file `.env.cloudflare-deploy-hook`. Read and trim the URL in memory. Keep it out of tracked files, logs and responses.
- Report the pushed commit message alongside the hook result, including the build ID and status if Cloudflare returns them. The hook builds its configured branch and accepts no commit-message field. A queued or reused build is an acknowledgement, and deployment verification is a separate check.
