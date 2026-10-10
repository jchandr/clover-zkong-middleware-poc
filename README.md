# Clover POS ↔ Zkong ESL Cloud Middleware

A Node.js/TypeScript middleware that synchronizes product catalog, prices, and inventory between Clover POS and Zkong ESL Cloud, running locally or in Docker with Cloudflare Tunnel for webhook connectivity.

---

## Prerequisites

- **Docker** & **Docker Compose** (v2+)
- **Cloudflare account** with a domain managed by Cloudflare (for tunnel DNS)
- **Clover Developer account** (sandbox or production)
- **Zkong ESL Cloud account** (EU server: `esl-eu.zkong.com`)

---

## Quick Start

```bash
# 1. Clone / navigate to project
cd cloverPosDemo

# 2. Configure environment variables (see below)
cp .env.example .env
# edit .env with your credentials

# 3. Build and start containers
docker compose up -d --build

# 4. First run: configure Cloudflare tunnel (see Tunnel Setup below)
docker compose exec cloudflared sh
```

---

## Environment Variables (`.env`)

Copy `.env.example` → `.env` and fill in every value:

### Clover

| Variable | Where to find it |
|----------|------------------|
| `CLOVER_CLIENT_ID` | Clover Developer Dashboard → Your Apps → [App] → App Settings → **Client ID** |
| `CLOVER_MERCHANT_ID` | Clover Developer Dashboard → Test Merchants → [Merchant] → **Merchant ID** (also in URL: `https://sandbox.dev.clover.com/dashboard/m/[MERCHANT_ID]`) |
| `CLOVER_AUTH_CODE` | Clover Developer Dashboard → Your Apps → [App] → App Settings → **Webhooks** section → **Clover Auth Code** (shown after webhook URL is verified) |

**How to get `CLOVER_AUTH_CODE`:**
1. Register your app in Clover Developer Dashboard (sandbox or production)
2. Install the app on your test merchant
3. In App Settings → Webhooks, enter your public webhook URL (e.g., `https://your-subdomain.yourdomain.com/webhooks/clover`)
4. Click **Send Verification Code** → copy the code from the POST body → paste it in the Verification Code field → **Verify**
5. The **Clover Auth Code** appears in the Webhooks section — copy it to `CLOVER_AUTH_CODE`

> **Note:** Use sandbox base URL (`https://sandbox.dev.clover.com/v3/merchants`) for development.

### Zkong

| Variable | Where to find it |
|----------|------------------|
| `ZKONG_ACCOUNT` | Your Zkong Cloud portal login username |
| `ZKONG_PASSWORD` | Your Zkong Cloud portal login password |
| `ZKONG_MERCHANT_ID` | Zkong portal → Merchant/Store management → **Merchant ID** |
| `ZKONG_AGENCY_ID` | Zkong portal → Agency/Reseller management → **Agency ID** (if applicable) |
| `ZKONG_API_BASE` | Default: `https://esl-eu.zkong.com` (EU server) |
| `ZKONG_STORE_ID` | Zkong **store** ID from `GET /zk/store/storeList` (the `storeId` field, a large integer — **not** the org ID). Optional; enables promo strategy visibility logging. |
| `ZKONG_POLL_INTERVAL_MS` | Zkong → Clover poller interval in ms (default: `60000`, use `1000` for testing) |

### App

| Variable | Description |
|----------|-------------|
| `PORT` | Middleware HTTP port (default: `3000`) |

---

## Cloudflare Tunnel Setup

The official `cloudflare/cloudflared` Docker image is **distroless (no shell)**, so this project uses a custom Alpine-based image that lets you `docker compose exec cloudflared sh` for interactive setup.

You created the tunnel `clover-zkong-middleware` (ID `bf85afb5-1f3e-49b9-a2d1-60a72fafbfec`) via the Cloudflare dashboard. That means it is a **remotely-managed tunnel** — ingress is configured in the dashboard UI, not via a local `config.yml`.

You are on `dash.cloudflare.com/.../public-hostname/add` for tunnel `clover-zkong-middleware`.

Fill the **Add a published application route** form as follows:

| Field | Value to enter | Why |
|-------|---------------|-----|
| **Hostname** | `clokong` (already filled, keep as is) | |
| **Domain** | `fullform.one` (already filled) | Together → `clokong.fullform.one` — your public webhook hostname |
| **Path** | **Leave empty** (delete `^/blog` if present) | Empty = match all paths, so both `https://clokong.fullform.one/webhooks/clover` and `https://clokong.fullform.one/health` are routed. Use a path only if you want to restrict to a prefix. |
| **Service Type** | `HTTP` | Select from the dropdown |
| **Service URL** | `middleware:3000` | **Not** `localhost:8080`. `middleware` is the Docker Compose service name, resolved via the shared `poc-net` network. `localhost` inside the `cloudflared` container would point to itself, not the middleware. Port is `3000` (see `PORT` in `.env`). Full URL is `http://middleware:3000`. |

Click **Save** / **Create**. Cloudflare will automatically create the DNS `CNAME` for `clokong.fullform.one` → `<tunnel-id>.cfargotunnel.com` — no manual DNS step needed.

Then start the tunnel connector. The connector only needs the **tunnel token** (no local `config.yml` or `credentials-file`). This project is already wired to pick it up from `cloudflared/.env`:

1. In the dashboard, go to **Tunnels** → `clover-zkong-middleware` → **Configure** → copy the **tunnel token** (starts with `eyJhI...`).

2. Save it to `cloudflared/.env` (one-time):

   ```bash
   cp cloudflared/.env.example cloudflared/.env
   # edit cloudflared/.env and paste:
   # TUNNEL_TOKEN=eyJhI...
   ```

   > `cloudflared/.env` is gitignored. `cloudflared/.env.example` is the template — see it for where to find the token.

3. (Re)start the stack — `entrypoint.sh` auto-detects `TUNNEL_TOKEN` and runs the tunnel as PID 1:

   ```bash
   docker compose up -d --build
   # or if already running:
   docker compose restart cloudflared
   ```

Your public webhook URL is now:  
`https://clokong.fullform.one/webhooks/clover`

> **How this works:** `docker-compose.yml` loads `cloudflared/.env` via `env_file`, so `TUNNEL_TOKEN` is available inside the `cloudflared` container. Its `entrypoint.sh` checks for `TUNNEL_TOKEN` — if set, it does `exec cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"` immediately.

> **Tip:** `middleware:3000` works because both containers share the `poc-net` Docker network. Do not use `localhost:8080` — that would point inside the `cloudflared` container itself and miss the middleware entirely.

### Verify tunnel is running

```bash
docker compose logs cloudflared
# Should show: "Registered ingress rules", "Starting tunnel", "Connection registered"
# For dashboard-managed tunnels: "Updated to new configuration" after saving the route
```

---

## Register Clover Webhook

1. In Clover Developer Dashboard → Your Apps → [App] → App Settings → Webhooks
2. Webhook URL: `https://clokong.fullform.one/webhooks/clover` (the public hostname you just routed)
3. Click **Send Verification Code** → copy code → paste in **Verification Code** field → **Verify**
4. Subscribe to events: **Inventory** (items), **Orders** (optional)
5. Save

The middleware will now receive item/inventory create/update/delete events at `/webhooks/clover`.

---

## Run the Stack

```bash
# Build and start (detached) — middleware, postgres db, and cloudflared
docker compose up -d --build

# View logs
docker compose logs -f middleware
docker compose logs -f cloudflared
docker compose logs -f db
```

### Health check

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Database (Postgres)

The stack runs Postgres as a separate container (`db`, `postgres:16-alpine`) with data persisted in the `pgdata` volume and port `5432` exposed to the host. **DB credentials are read from `.env`** (see `.env.example`).

`.env` (and `.env.example`) now contain:
```env
POSTGRES_DB=clover_zkong
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgres://postgres:postgres@db:5432/clover_zkong
```
`docker-compose.yml` loads `.env` and uses `${POSTGRES_DB}`, `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}` for the `db` service (with `:-` defaults). Change them in `.env` and re-run `docker compose up -d` to spin the DB with custom credentials — keep `DATABASE_URL` in sync (user/password/db must match).

- **Inside Docker** (middleware): host is `db` → `DATABASE_URL=postgres://postgres:postgres@db:5432/clover_zkong`
- **From host** (DBeaver, DataGrip, psql, TablePlus): host is `localhost`:
  ```bash
  # psql (install: brew install postgresql)
  PGPASSWORD=postgres psql -h localhost -U postgres -d clover_zkong -c "\dt"
  # DBeaver: Host=localhost Port=5432 Database=clover_zkong User=postgres Password=postgres
  # Then: SELECT * FROM stores; SELECT * FROM item_map; SELECT * FROM sync_log;
  ```

Tables: `stores`, `item_map` (`standard_price`/`last_pushed_price`/`promo_active`), `sync_log`. Schema is auto-created on middleware startup via `src/db/connection.ts:initDb()`.

### One-time migration (after upgrade)

The middleware does **not** auto-migrate an existing database. If `item_map` was created before `promo_active` was added, run:

```bash
docker compose exec db psql -U postgres -d clover_zkong \
  -c "ALTER TABLE item_map ADD COLUMN IF NOT EXISTS promo_active BOOLEAN NOT NULL DEFAULT FALSE;"
```

If running the middleware **locally without Docker** (`npm run dev`), set `DATABASE_URL` in `.env` to use `localhost`:
```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/clover_zkong
```

### Price units & discount sync

- **Both Clover and Zkong use cents.** Clover `$8700.00` = `870000` → Zkong `price=870000` (`unitName: 1`, no division).
- **Zkong discounts live in extended fields**, not `price`: `custFeature1` = Was, `custFeature2` = Discount %, `custFeature3` = Discount Number.
- Poller computes sale = `Was × (1 − Discount%/100)` (or Discount Number directly) and pushes it to Clover. Clearing the discount restores the base price.

See **docs/USER_GUIDE.md** for the full discount flow, migration steps, and limitations.

---

## Development / Local Testing

```bash
# Install deps
npm install

# Type-check
npm run typecheck

# Build
npm run build

# Run locally (without Docker) - needs .env with CLOVER_AUTH_CODE etc.
npm run dev
```

### Test webhook locally (with tunnel running)

```bash
# Simulate Clover item.update webhook
curl -X POST https://clokong.fullform.one/webhooks/clover \
  -H "Content-Type: application/json" \
  -H "X-Clover-Auth: <YOUR_CLOVER_AUTH_CODE>" \
  -d '{"merchants":{"<MERCHANT_ID>":[{"objectId":"I:ABC123","type":"UPDATE","ts":1234567890}]}'
```

Expected: `{"received":true}`

---

## Project Structure

```
cloverPosDemo/
├── src/
│   ├── config/env.ts              # env loading + validation
│   ├── db/
│   │   ├── connection.ts          # Postgres pool + initDb (schema)
│   │   └── models/                # item_map, store, sync_log
│   ├── polling/zkong-poll.ts      # Zkong → Clover poller + discount logic
│   ├── services/
│   │   ├── clover/client.ts       # Clover API (get/update item)
│   │   └── zkong/                 # Zkong API (auth, items, client)
│   ├── webhooks/
│   │   ├── server.ts              # Express app + routes
│   │   └── handlers/clover.ts     # Clover webhook → Zkong sync
│   └── index.ts                   # entrypoint
├── cloudflared/
│   ├── Dockerfile               # Alpine + cloudflared binary (has shell!)
│   ├── entrypoint.sh            # runs tunnel via TUNNEL_TOKEN, or idles if not set
│   ├── .env.example             # TUNNEL_TOKEN template
│   └── .env                     # your tunnel token (gitignored, not committed)
├── docker-compose.yml             # middleware + cloudflared on shared network
├── Dockerfile                     # middleware container (node:20-alpine)
├── .env.example                   # template
├── package.json / tsconfig.json
└── docs/
    ├── USER_GUIDE.md              # setup, discount flow, migration
    └── architecture.md            # full architecture & decision log
```

---

## Current Implementation Status

| Feature | Status |
|---------|--------|
| Clover webhook receiver (`/webhooks/clover`) | ✅ Done + verified |
| `verificationCode` handshake | ✅ Done |
| `X-Clover-Auth` header verification (constant-time) | ✅ Done |
| Fail-closed if `CLOVER_AUTH_CODE` unset | ✅ Done |
| Docker Compose (middleware + cloudflared) | ✅ Built |
| Custom cloudflared image with shell | ✅ Done |
| Entrypoint: `TUNNEL_TOKEN` → forward, else idle | ✅ Done |
| Cloudflare tunnel DNS routing | 📋 Manual step (one-time) |
| Clover webhook registration | 📋 Manual step |
| Zkong auth client (RSA login) | ✅ Done |
| Clover → Zkong price sync (webhook → batchImportItem) | ✅ Done |
| Zkong → Clover price sync (poller) | ✅ Done |
| Zkong discount → Clover (Was / Discount % / Discount Number) | ✅ Done |
| Barcode preservation (no duplicate Zkong items) | ✅ Done |
| Promo strategy visibility (`strategy/list`) | ⚠️ Blocked by account permission (10030) |
| `item_map` / `stores` / `sync_log` Postgres schema | ✅ Done |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `docker compose exec cloudflared sh` fails | Ensure `stdin_open: true` and `tty: true` in compose (already set) |
| Webhook returns 401 | Check `CLOVER_AUTH_CODE` matches Dashboard exactly; verify header name is `X-Clover-Auth` |
| Tunnel shows `Inactive` | Ensure `TUNNEL_TOKEN` is set in `cloudflared/.env` and restart `cloudflared` |
| `middleware:3000` not reachable | Both containers must share `poc-net` network (compose handles this) |
| Verification code not received | Ensure webhook URL is HTTPS; tunnel must be running before "Send Verification Code" |

---

## License

Internal POC — not for production use without security review.