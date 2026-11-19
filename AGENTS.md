# Change requirements

## Preserve application behaviour

- Preserve existing functionality unless the user explicitly requests a behaviour change.
- Review every changed or moved file against the previous Git version. Check imports, assets, API contracts, authentication, database bindings and build paths.
- Keep browser source in `Frontend/`, Worker source in `Backend/`, and local-only tools and secrets in the ignored `Documentation/Local/` folder. Publish only `build/` and explicitly allowed static assets. Never expose the repository root as a static directory.
- Preserve the existing D1 database ID, account passwords and session behaviour when making unrelated changes.

## Explain non-obvious code

- Use code comments to explain non-obvious flows and assumptions. Update comments when the relevant code changes.
- Explain JSON configuration and generated lockfiles in [README.md](README.md). Keep JSON valid and leave generated lockfile records to the package manager.

## Verify changes

- Report source review, dependency audit, successful build and browser or runtime verification separately. Static comparison alone cannot establish that runtime behaviour is unchanged.
- Cloudflare verifies builds under the current workflow. Do not install dependencies or run local builds unless the user changes that preference. Read-only dependency audits and static or syntax checks are allowed.

## Before pushing to GitHub

1. Prepare a concrete, reviewable change and identify any remaining functionality or deployment risk.
2. Obtain explicit approval for each push. A previous approval applies only to that push.

## After a successful push

1. After an approved push to `origin/main` or `origin/preview`, confirm the remote tip of that branch and read its latest commit message.
2. For `main`, use `Documentation/Local/.env.cloudflare-deploy-hook`. For `preview`, use `Documentation/Local/.env.cloudflare-preview-deploy-hook`. Read and trim the chosen URL in memory. Keep hook URLs out of tracked files, logs and responses.
3. Send a bodyless HTTP `POST` to the Cloudflare Workers Builds hook.
4. Report the commit message and hook result. Include the build ID and status when Cloudflare returns them.

The hook builds its configured branch and accepts no commit-message field. A queued or reused build acknowledges the request. Verify deployment separately.
