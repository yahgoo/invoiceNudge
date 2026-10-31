# Invoice Nudge

A one-page overdue invoice dashboard using Node.js 22+, plain browser JavaScript, and the official Neo4j JavaScript driver. Reminders use a deterministic local template. There is no AI inference or email sending.

## Install and run

```sh
cd /Users/kmsum/Downloads/Adal/invoice-nudge
npm install
npm start
```

Open http://localhost:3000. Without database settings, the app starts in clearly labeled demo mode. Seven realistic invoices are available immediately.

## Connect Neo4j

Use a dedicated Neo4j AuraDB Free instance, or an existing local Neo4j Desktop instance. Aura provides a `neo4j+s://` URI and a generated password when you create an instance. Save its credential download privately. The username is normally `neo4j`; use the database name shown in the connection details, or leave it blank to use the default. For local Desktop, use its connection URI (normally `bolt://localhost:7687`) and the password you set for that instance.

Official guides:
- https://neo4j.com/docs/aura/getting-started/create-instance/
- https://neo4j.com/docs/aura/getting-started/connect-instance/
- https://neo4j.com/docs/desktop-manual/current/

Fill in the existing ignored `.env` file privately. `.env.example` lists the names without secrets:

```dotenv
NEO4J_URI=neo4j+s://YOUR_INSTANCE.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=YOUR_PRIVATE_PASSWORD
NEO4J_DATABASE=neo4j
PORT=3000
```

Alternatively, set `NEO4J_CREDENTIALS_FILE` in `.env` to the absolute path of your downloaded environment-format credentials file. The server reads it locally; credentials do not need to be copied into this project. Nonempty explicit environment settings take precedence over the credential file.

The password above is a placeholder, not a credential. Never paste your real password into chat or commit `.env`. The server loads `.env` automatically. Shell environment variables take precedence. Database settings are never read by browser code. Keep `.env` owner-readable only (`chmod 600 .env`).

## Initialize and seed

With the instance running and `.env` configured:

```sh
cd /Users/kmsum/Downloads/Adal/invoice-nudge
npm run seed
npm start
```

`npm run seed` creates uniqueness constraints and seeds the demo. It exits with a nonzero status and a safe message if Neo4j is not ready. Normal app startup also initializes and seeds automatically. Running either command repeatedly does not duplicate seed records or reset existing due dates, contact status, vendor information, or history. The database user needs permission to create constraints and read/write these nodes.

To restart, stop the running server with Ctrl+C, then run `npm start`. Changes to `.env` take effect on restart. `PORT=3001 npm start` runs a second copy on another port if needed.

## Graph and persistence

```text
(:Vendor {id})-[:HAS_INVOICE]->(:Invoice {id})-[:HAS_REMINDER]->(:Reminder {id})
```

Each label has a unique `id` constraint. Seed reminders have stable IDs; new reminders use UUIDs. Contact status and the full reviewed reminder are written together in one transaction. All record values use Cypher parameters. The process reuses one driver, closes each session in `finally`, and closes the driver on SIGINT/SIGTERM. Driver and transaction timeouts bound connection failures.

- **Neo4j mode:** invoices, vendors, status, and history come from Neo4j. Changes survive server restarts.
- **Demo mode:** the same workflow uses memory. Changes survive page refreshes but not server restarts. No temporary changes are synced to Neo4j.
- **Connection failure after startup:** the dashboard keeps the last successful data snapshot in temporary demo mode. Restart after restoring the connection. A failed database save is reported as having an unknown outcome, rather than being silently replayed or reported as saved.
- The header, connection banner, footer, and `/api/status` identify the active storage mode without revealing credentials or connection details.

## Three-step demo

1. Select Brightline Electrical, invoice INV-1063. Inspect the amount, due date, overdue days, and history.
2. Click **Draft reminder**, then review or edit the local template.
3. Click **Mark as Contacted**. The invoice status, dashboard counts, next action, and full history update. In Neo4j mode, restart the server to demonstrate persistence.

Drafting never creates a reminder record or sends a message. Only the explicit contact action records the reviewed message.

## Ask about invoices

The dashboard includes a compact read-only chat panel backed by `POST /api/chat`. A deterministic parser supports outstanding invoices, follow-up priority, status by invoice ID, and history by vendor or invoice. User text is passed only as parameters to a fixed Neo4j read query. Chat never writes status, reminders, or conversation memory, and does not use a model provider.

Priority ranks overdue outstanding invoices by amount multiplied by days overdue, highest first. Contacted invoices are still outstanding, so check the latest follow-up before acting. Status and list answers include short latest-follow-up excerpts; history shows up to 20 latest entries per invoice. Responses are limited to 50 invoices (top five for priority). Ambiguous or missing references prompt clarification. If Neo4j cannot be queried, chat says so instead of using demo or cached facts.

Demo at http://localhost:3000:
1. Click **What should I follow up on first?** in the chat panel.
2. Click **What’s the status of invoice INV-1063?** and compare it with the invoice detail panel.
3. Try **Show the follow-up history for Northgate**. The original draft/review/contact workflow remains separate and unchanged.

The current build includes the chatbot. `chat.js` is included in the existing Daytona deployment upload allowlist; no infrastructure changes are required. To deploy only to an existing sandbox, run `DAYTONA_REQUIRE_EXISTING=1 npm run daytona:deploy`.

## Daytona sandbox

See [DAYTONA.md](DAYTONA.md) for private sandbox deployment, preview access, credential handling, and repeatable start/stop commands. The local app and its Neo4j configuration remain usable independently.

## Checks

```sh
npm test
```

These focused tests exercise demo behavior and the data layer using a simulated driver. A real Neo4j instance is required to verify live Cypher execution and persistence.
