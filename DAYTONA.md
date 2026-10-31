# Run Invoice Nudge in Daytona

Date: 2026-10-31
POC: Project maintainer
TL;DR: Add a replacement Daytona key privately to local `.env`, then run `npm run daytona:deploy` and `npm run daytona:open`. The app uses the existing Neo4j database and local reminder template. Local configuration is never uploaded.

## Prerequisites

- Node.js 22+ locally.
- A Daytona account with sandbox read/write access, available credits, and permission to use custom images.
- A valid `DAYTONA_API_KEY` saved privately in this project's ignored `.env`, or exported in the terminal environment. Revoke keys exposed in chat.
- The existing Neo4j settings or `NEO4J_CREDENTIALS_FILE` reference. Leave the working configuration intact.

Add these lines privately to the existing `.env` without replacing its Neo4j settings:

```dotenv
DAYTONA_API_KEY=YOUR_REPLACEMENT_KEY
DAYTONA_SANDBOX_NAME=invoice-nudge
```

The key above is a placeholder. Never put actual credentials in source files, commands, chat, or logs.

## Commands

```sh
cd /Users/kmsum/Downloads/Adal/invoice-nudge
npm ci --include=dev
npm run daytona:deploy
npm run daytona:open
```

The deployment helper uses the official `@daytona/sdk` version locked in `package-lock.json` (0.227.0 when implemented). No CLI is required. It finds the sandbox by name before creating one. A failed lookup other than “not found” never triggers creation. An existing sandbox must carry this helper's ownership label and have private previews enabled.

`daytona:deploy` creates or starts the named sandbox, uploads only an explicit list of app files, installs production dependencies, updates its server environment, verifies Neo4j by running the idempotent seed inside the sandbox, and runs `npm start` in a managed background session. The server binds to `0.0.0.0:3000`. Deployment verifies database-backed dashboard reads and local template drafting, then checks authenticated preview access and that unauthenticated access is denied. It does not mark any invoice contacted.

Run `daytona:deploy` again for subsequent starts or source updates. It reuses the same sandbox and restarts only its managed app session. It does not delete the sandbox, local environment, or Neo4j records. Seed operations preserve existing statuses and history.

`daytona:open` opens a five-minute signed URL in your local browser without printing or saving its token. The regular preview URL printed by deployment requires authentication. Treat signed URLs as temporary credentials and do not share them. If the sandbox has auto-stopped, run `daytona:deploy` before opening it again.

Stop compute when finished:

```sh
npm run daytona:stop
```

The sandbox auto-stops after 60 minutes of inactivity and is not automatically deleted. Preview traffic does not reset Daytona's inactivity timer. Restarting uses the same sandbox and the same Neo4j data. Daytona billing may apply while running or storing the sandbox.

## Credential handling

The helper never uploads `.env`, downloaded credentials, local dependencies, or the deployment helper itself. The Daytona API key stays on your computer. Only `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`, `PORT`, and `NODE_ENV` are sent through the authenticated Daytona environment API for newly spawned server processes. They are not interpolated into shell commands or written to source files. Error bodies and command output are suppressed unless explicitly safe.

Daytona's opaque Secrets feature substitutes placeholders in HTTPS headers only. Neo4j's official driver authenticates through Bolt, so those placeholders cannot be used as the database password. This setup uses ordinary server-side sandbox environment variables instead. The real password is necessarily readable to processes and administrators with access to that sandbox; it is not an opaque vault secret. Restrict sandbox and account access accordingly. If your policy forbids plaintext server environment credentials, do not run this deployment; the current Bolt-based app needs a different credential delivery architecture.

For manual setup in Daytona, add the four `NEO4J_*` variables through the sandbox environment settings, not the HTTPS-only opaque Secret mount. Copy them privately from the Neo4j credential file; do not put values in chat or shell history. The automated deploy command updates these same variables from your existing local configuration, so no manual transfer is needed when it runs successfully.

## Network troubleshooting

Deployment fails explicitly if inside-sandbox Neo4j verification fails; it does not claim a successful database deployment in demo mode. The local app remains available at http://localhost:3000 and is not stopped or modified by the helper.

Neo4j Aura normally requires outbound DNS and TLS/Bolt connectivity to the instance and its routed hosts on TCP 7687. If an instance-side IP allowlist is enabled, allow only your Daytona runner's approved egress IP/CIDR (obtain it from Daytona support or your organization networking settings). Do not enable unrestricted incoming database access. If your organization blocks sandbox egress, ask its administrator to permit the Neo4j endpoint/routed hosts and TCP 7687; package installation also needs access to the npm registry over HTTPS. This helper does not loosen network policies automatically.

A database address such as `localhost` in the sandbox refers to the sandbox itself, not your Mac. Use the existing reachable Aura URI for this project. Keep its `neo4j+s://` encryption scheme.

## Official API references

- https://www.daytona.io/docs/en/typescript-sdk/daytona/
- https://www.daytona.io/docs/en/typescript-sdk/sandbox/
- https://www.daytona.io/docs/en/typescript-sdk/process/
- https://www.daytona.io/docs/en/typescript-sdk/file-system/
- https://www.daytona.io/docs/en/secrets/
