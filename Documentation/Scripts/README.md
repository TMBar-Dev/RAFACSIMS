# One-off scripts

[Reset-RafacSimsPassword.ps1](Reset-RafacSimsPassword.ps1) prompts for a username and temporary password and generates a single SQL line. Run it with `-Copy` to copy the complete line. Execute it in the correct database's D1 Console using an authenticated Cloudflare account with database access. The script itself does not connect to Cloudflare.

Keep machine-local scripts and deployment hook files in the ignored `Documentation/Local/` folder.
