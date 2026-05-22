# quelora-dashboard-api — Developer Overview

**Stack:** Node.js · Express 4 · MongoDB · Redis · BullMQ · WebSocket (`ws`)
**Role in monorepo:** Multi-tenant admin backend for the Quelora platform. Provides the HTTP API consumed by the React dashboard SPA, the WordPress plugin sync endpoints, and the Sentinel Debug Broker WebSocket server.

---

## Directory Tree

```
quelora-dashboard-api/
├── app.js                              # Entry point — Express init, DB connect, HTTP server, WS broker
├── package.json
├── .env / .env.example                 # Environment config (see reference below)
│
├── routes/
│   ├── routes.js                       # Aggregator — mounts all routers
│   ├── authRoutes.js
│   ├── userRoutes.js
│   ├── adminRoutes.js
│   ├── clientRoutes.js
│   ├── statsRoutes.js
│   ├── reputationRoutes.js
│   ├── resilienceRoutes.js
│   ├── syncRoutes.js                   # WordPress sync + integration config
│   ├── jobsRoutes.js
│   ├── notificationsRoutes.js
│   ├── mediaRoutes.js
│   ├── healthRoutes.js
│   └── activateAllJobs.js
│
├── controllers/
│   ├── authController.js               # Login, 2FA, registration, email OTP
│   ├── userController.js               # Profile, CRUD, role management
│   ├── clientController.js             # Client CRUD, posts, comments, moderation
│   ├── statsController.js              # Analytics queries
│   ├── reputationController.js
│   ├── resilienceController.js
│   ├── syncController.js               # WordPress batch upserts + integration config
│   ├── jobsController.js
│   ├── notificationsController.js
│   ├── mediaController.js
│   ├── adminController.js              # God-mode CID switching
│   └── suggestionController.js
│
├── middlewares/
│   ├── adminAuthMiddleware.js          # JWT validation against JWT_ADMIN_SECRET
│   ├── syncAuthMiddleware.js           # Raw Bearer token vs client.login.jwtSecret
│   ├── integrationAuthMiddleware.js    # HS256 JWT vs client.login.jwtSecret (60s TTL)
│   ├── roleAuthMiddleware.js           # checkRole([...]) factory
│   └── uploadMiddleware.js             # Multer factory (size + MIME filtering)
│
├── models/
│   ├── User.js                         # Dashboard user model + instance methods
│   └── UserSchema.js                   # Mongoose schema definition
│
├── services/
│   ├── sentinelDebugBrokerService.js   # WebSocket debug broker (Sentinel ↔ Agent)
│   ├── puppeteerService.js             # Headless scraping (URL metadata)
│   └── commentAnalysisNolanService.js  # Nolan Chart political analysis (AI)
│
├── config/
│   └── commentAnalysisNolanPromptConfig.js
│
├── utils/
│   └── accessControl.js               # validateCidAccess() — multi-tenancy boundary
│
├── cron/
│   └── index.js                        # Cron job initialization
│
├── locale/                             # i18n strings (12 languages)
│   └── {en,es,fr,de,it,pt,ru,ar,he,hi,zh,jp}.json
│
├── seed/                               # One-off DB seed / migration scripts
│
└── data/
    └── geoip_cache/GeoLite2-City.mmdb  # MaxMind geolocation DB
```

---

## Startup Flow

```
app.js
  1. dotenv.config()
  2. connectDB()                  — MongoDB via @quelora/common
  3. Express app
       helmetConfig
       dynamicCorsConfig
       express.json (25 MB limit)
       requestLogger
       cacheInvalidator           — purges Redis cache on POST/PUT/PATCH/DELETE
       setupRoutes(app)
  4. cron/index.js                — initialize scheduled tasks
  5. http.createServer(app)
  6. sentinelDebugBrokerService   — attach WS server to same HTTP server at /ws/debug-broker
  7. listen on PORT
```

---

## Middleware Chain (per request)

| Layer | Middleware | Note |
|-------|-----------|------|
| 1 | Trust proxy (2 hops) | Correct IP from reverse proxy |
| 2 | Helmet | Security headers |
| 3 | CORS | Dynamic per-origin |
| 4 | Body parser | JSON + urlencoded, 25 MB |
| 5 | requestLogger | From @quelora/common |
| 6 | cacheInvalidator | Auto-purge on mutations |
| 7 | Route-level auth | adminAuth / syncAuth / integrationAuth |
| 8 | roleAuthMiddleware | Per-route capability check |
| 9 | Controller | Business logic |
| 10 | globalErrorHandler | From @quelora/common |

---

## Route Map

### `/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/generate-token` | none | Login (password → JWT, or pre-auth token if 2FA) |
| POST | `/auth/verify-2fa` | none | TOTP code → full JWT |
| POST | `/auth/renew-token` | adminAuth | Renew expired admin token |
| POST | `/auth/register` | none | Self-registration + OTP email |
| POST | `/auth/verify-email` | none | OTP verification |
| POST | `/auth/resend-verification` | none | Resend OTP |

### `/user`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/user/profile` | any | Own profile |
| GET | `/user/clients` | any | Encrypted client list |
| PATCH | `/user/profile` | any | Update name/email/locale/picture |
| POST | `/user/change-password` | any | Change password |
| POST | `/user/2fa/setup` | any | Init 2FA — returns QR code |
| POST | `/user/2fa/verify` | any | Confirm TOTP setup |
| POST | `/user/2fa/disable` | any | Disable 2FA |
| GET | `/user/list` | admin+ | List dashboard users |
| POST | `/user/create` | god/admin | Create user |
| POST | `/user/:id/reset-password` | admin+ | Reset user password |
| DELETE | `/user/:id` | admin+ | Soft-delete user |
| PATCH | `/user/:id/restore` | admin+ | Restore deleted user |
| PATCH | `/user/:id/unlock` | admin+ | Unlock locked account |
| PATCH | `/user/:id` | admin+ | Update user details |
| PATCH | `/user/:id/enterprise` | god | Set user `accountType` (community/enterprise) |

### `/admin`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/search` | god | Search clients by CID or description |
| POST | `/admin/set` | god | Set active CID in Redis (god-mode scope) |
| POST | `/admin/jobs/suggestions` | admin+ | Manually trigger suggestion job |

### `/client`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/client/generate-cid` | Create client + generate CID |
| PUT | `/client/update-cid` | Update existing client |
| POST | `/client/upsert` | Idempotent create-or-update |
| GET | `/client/posts` | List posts (paginated) |
| GET | `/client/post/:cid/:entity/` | Single post data |
| GET | `/client/posts/:postId/` | Comments for post |
| PUT | `/client/upsert-post` | Create/update post |
| PATCH | `/client/trash` | Soft-delete post |
| PATCH | `/client/restore` | Restore post |
| POST | `/client/moderation` | Test moderation rules |
| POST | `/client/:cid/test-toxicity` | Test Perspective API |
| DELETE | `/client/delete/:cid` | Hard-delete client (admin) |
| GET | `/client/users` | Client user list |
| GET | `/client/users/:author/stats` | Comment statistics |
| GET | `/client/users/:author/nolan` | Nolan Chart analysis |
| GET | `/client/users/:author/comments-list` | User comment list |
| PATCH | `/client/users/:author/ban` | Ban user |
| PATCH | `/client/users/:author/unban` | Unban user |
| GET | `/client/logs` | System monitoring logs |
| GET | `/client/reports` | Moderation reports |
| PATCH | `/client/reports/:reportId/resolve` | Resolve report |
| PATCH | `/client/comments/:commentId/hide` | Hide comment |
| PATCH | `/client/comments/:commentId/unhide` | Unhide comment |
| PATCH | `/client/:cid/quick-setup` | Quick setup wizard |
| PATCH | `/client/:cid/modules` | Update enterprise modules + community plugins for a client |
| POST | `/client/:cid/test-geolocation` | Test geolocation service |
| POST | `/client/:cid/force-geo-update` | Force geolocation update |

### `/client/:cid/resilience`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/client/:cid/resilience` | Get resilience config |
| POST | `/client/:cid/resilience` | Save resilience config |
| POST | `/client/:cid/resilience/generate-keys` | Rotate ed25519 keypair |

### `/client/:cid/v1/` and `/client/:cid/sync/` (WordPress integration)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/client/:cid/v1/integration/config` | integrationAuth (HS256 JWT, 60s) | WordPress plugin fetches full config |
| POST | `/client/:cid/v1/nodes/batch-upsert` | syncAuth (raw Bearer) | Batch upsert posts from WordPress |
| POST | `/client/:cid/v1/profiles/batch-upsert` | syncAuth (raw Bearer) | Batch upsert users from WordPress |
| POST | `/client/:cid/sync/nodes/batch-upsert` | syncAuth | Legacy alias |
| POST | `/client/:cid/sync/profiles/batch-upsert` | syncAuth | Legacy alias |

### `/stats`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats/get` | System-wide totals (users, posts, comments, likes) |
| GET | `/stats/get/geo` | Geolocation breakdown |
| GET | `/stats/get/posts/list` | Post list with analytics |
| GET | `/stats/get/post/:entity` | Individual post analytics |
| GET | `/stats/get/top-users/comments` | Top commenters |
| GET | `/stats/get/profile-analytics` | Profile analytics |
| GET | `/stats/get/moderation-analytics` | Moderation metrics |
| GET | `/stats/get/users/:author/reputation` | Reputation log |

### `/reputation`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reputation/:cid` | Get reputation config |
| PUT | `/reputation/:cid` | Update weights, limits, trust levels |

**Default weights:** helpful_mark(10), pinned(50), correction(20), upvote(1), downvote(-2), spam_report(-50), mod_removal(-100)
**Trust levels:** Novice(<0), Member(0–49), Trusted(50+)

### `/jobs`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/jobs` | List job configs + last execution log |
| GET | `/jobs/logs` | All execution logs |
| PATCH | `/jobs/:jobKey` | Update job (enabled, cron, params) |
| POST | `/jobs/:jobKey/trigger` | Trigger job immediately |

**Built-in jobs (CLIENT_JOB_DEFS):**

| Key | Default cron | Notes |
|-----|-------------|-------|
| `reputation` | `*/30 * * * * *` | Every 30s |
| `suggestion` | `0 2 * * *` | Daily 2am |
| `activity` | `*/10 * * * * *` | Every 10s |
| `gravity-decay` | `*/30 * * * *` | Every 30m |
| `gamification` | `*/5 * * * * *` | Enterprise only |
| `ad-stats` | `*/5 * * * * *` | Enterprise only |

### `/notifications`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications/send` | Queue Web Push notification (BullMQ) |
| POST | `/notifications/send-mail` | Queue email (BullMQ → SMTP) |
| GET | `/notifications/search` | Search push-enabled profiles |
| GET | `/notifications/generate-vapid-keys` | Generate VAPID keypair (god/admin) |

### Other

| Method | Path | Description |
|--------|------|-------------|
| POST | `/media/upload` | Upload image/video (25 MB, multer → `public/assets/ads/`) |
| GET | `/health` | Liveness probe: `{ status, uptime, timestamp }` |

---

## Authentication & Authorization

### JWT flow

```
POST /auth/generate-token
  → bcrypt.compare(password)
  → if 2FA enabled:
      return { requires2FA: true, token: preAuthJWT (5 min, type:'2FA_PRE_AUTH') }
  → else:
      return { token: fullJWT (72h), clients: AES-encrypted-per-CID }

POST /auth/verify-2fa
  → verify preAuthJWT
  → speakeasy.totp.verify(code, decryptedSecret)
  → return { token: fullJWT }
```

### JWT secrets

| Secret env var | Used for | Default TTL |
|---------------|---------|-------------|
| `JWT_SECRET` | Regular users | 72h |
| `JWT_ADMIN_SECRET` | admin / god / privileged | 72h |

**Token payload:** `{ userId, author, email, role, ip }`

### Role hierarchy

```
god (100)          — Master; manages all tenants via active_cid
  admin (50)       — Full client management
    editor (40)    — Content editing
    moderator (30) — Moderation actions
    advertiser (20)— Ad management
  analyst (15)     — Analytics read-only
  user (10)        — Base
```

`roleAuthMiddleware` uses numeric levels — higher roles always include lower permissions.

### God mode

- `POST /admin/set` stores `active_cid:{userId}` in Redis (TTL 86400s)
- All subsequent requests by the god user are scoped to that CID
- `GET /user/clients` returns only the active client when in god mode

### Account locking

5 consecutive failed logins → account locked for 1 hour. Unlock via `PATCH /user/:id/unlock` or expiry. Email notification sent on lockout.

### Sync auth (WordPress)

`syncAuthMiddleware` compares the raw `Authorization: Bearer {token}` value against `client.login.jwtSecret` stored in the Client document (strict equality, not JWT verification).

### Integration auth (WordPress config fetch)

`integrationAuthMiddleware` verifies an HS256 JWT signed with `client.login.jwtSecret`. TTL is 60 seconds — used exclusively by the WordPress plugin's setup wizard.

---

## Data Models

All models except `User` live in `@quelora/common/models`.

### User (dashboard user)

```js
{
  given_name, family_name,
  email, username,           // unique
  picture,
  locale,                    // default: 'en'
  password,                  // bcrypt(rounds=10)
  role,                      // god|admin|editor|moderator|advertiser|analyst|user
  twoFactorEnabled,
  twoFactorSecret,           // AES-encrypted
  failedLoginAttempts,
  lockUntil,                 // timestamp
  emailVerified,
  emailVerificationCode,
  emailVerificationExpires,
  accountType,               // community|enterprise — controls dashboard access gating
  isDeleted,                 // soft delete
  createdAt, updatedAt
}
```

> **Note:** `enterpriseModules` was removed from User. Plugin/module activation is now per-client — stored in `Client.enterpriseModules` and `Client.communityPlugins`. `accountType` on User remains for dashboard feature-gate checks (`useEnterprise`).

**Instance methods:** `comparePassword()`, `incrementLoginAttempts(ip)`, `isLocked()`
**Static:** `generateUniqueCID()` → `QU-{timestamp36}-{random5}`
**Pre-save hook:** hash password on change, encrypt 2FA secret
**Post-findOne hook:** auto-inject decrypted client configurations (skipped when `loadClients: false`)

### Client

Stores all per-tenant configuration. Key encrypted sub-objects:

| Field | Contains |
|-------|---------|
| `login` | `queloraSession`, `jwtSecret`, SSO provider details |
| `moderation` | provider (OpenAI/Grok/Gemini/DeepSeek), apiKey, config |
| `geolocation` | provider, apiKey |
| `vapid` | Web Push public/private keys |
| `email` | SMTP config |
| `turn` | TURN server credentials |
| `nostr` | Nostr relay config |
| `resilience` | Mode, triggers, weights, ed25519 keys |
| `postConfig` | Post display configuration |
| `jobsConfig` | Map of per-job settings |
| `enterpriseModules` | `string[]` — enabled enterprise modules (`surveys`, `gamification`, `advertising`, `network`, `resilience`, `push`, `liveMode`). God-only. |
| `communityPlugins` | `string[]` — enabled community plugins (`sentinel`, `placer`). Admin+. |

**Module management endpoint:** `PATCH /client/:cid/modules`
- Body: `{ enterpriseModules?: string[], communityPlugins?: string[] }`
- god can update both; admin can only update `communityPlugins`
- Validates against `VALID_ENTERPRISE_MODULES` / `VALID_COMMUNITY_PLUGINS` from `pluginRegistry.js`
- Calls `clearClientConfigCache(cid)` after save

**Client payload (login + `/user/clients`):** both `enterpriseModules` and `communityPlugins` are included as plain arrays (no encryption needed) in the encrypted client payload returned at login and by `GET /user/clients`.

### Other common models

| Model | Purpose |
|-------|---------|
| `Post` | Discussion threads (cid, entity, title, author, commentCount) |
| `Profile` | Community user profiles (author hash, name, picture, pushSubscriptions) |
| `Comment` | Individual comments (cid, postId, author, body, hidden, toxicity_score) |
| `Report` | Moderation reports (reporter, reason, status) |
| `ReputationConfig` | Per-client weights/limits/trust-levels |
| `ReputationLog` | Audit trail of reputation changes |
| `JobExecutionLog` | Job runs (cid, jobName, status, durationMs, error) |
| `Stats` / `GeoStats` / `PostStats` | Aggregated analytics |

---

## Services

### `sentinelDebugBrokerService`

WebSocket server attached to the HTTP server at path `/ws/debug-broker`.

**Architecture:**
```
Browser (Sentinel) ──[WS]──▶ Broker ◀──[WS]── Agent (AI/terminal)
```

**Session lifecycle:**
1. Sentinel connects → Broker generates 6-char hex PIN → Sentinel displays it
2. Agent connects with `JOIN_SESSION` + PIN + `INTERNAL_AI_SECRET`
3. Broker validates secret against env var, bridges the two sockets
4. Messages relay bidirectionally; Broker never inspects payload
5. Session auto-cleaned when either party disconnects

**Auth for Agent:** raw secret comparison against `INTERNAL_AI_SECRET` env var

**Max payload:** 10 MB (supports heap snapshots and large DOM trees)

**Command types (Agent → Broker → Sentinel):** `INSPECT_APP`, `INSPECT_ERRORS`, `INSPECT_NETWORK_LOG`, `INSPECT_CONSOLE_LOG`, `EXEC_JS`, `INSPECT_DOM`

**Keepalive:** protocol-level `ws.ping()` (auto-handled) + application-level `{ action: "PING" }` frames that must be answered with `{ action: "PONG" }`.

> **Important:** The `ws` module is at `apps/node_modules/ws` (workspace root), NOT in `quelora-dashboard-api/node_modules`. Require with absolute path: `require('/path/to/quelora-dx-env/apps/node_modules/ws')`.

### `puppeteerService`

Headless Chrome (no-sandbox) for URL metadata scraping. Prioritizes JSON API responses captured via network inspection; falls back to HTML parsing. Used for URL preview generation.

### `commentAnalysisNolanService`

Political spectrum analysis via Nolan Chart. Sends user comment history to a configurable AI provider (OpenAI, Grok, Gemini, DeepSeek) and returns:
```json
{ "economic_score": -3.5, "personal_score": 7.2 }
```
Axes: Economic Freedom (−10 → +10), Personal Freedom (−10 → +10).

---

## Encryption

### Transport encryption (client config delivery)

Client configs are AES-encrypted before being returned to the browser. Key derivation is deterministic from CID: `SHA-256(cid) → 32-byte AES key`. The frontend decrypts using the same derived key. This protects config in transit and in localStorage.

### Field-level encryption (at rest)

Sensitive fields (VAPID keys, email credentials, TURN credentials, Nostr keys, 2FA secrets, resilience ed25519 private key) are AES-encrypted in MongoDB using `ENCRYPTION_KEY` env var. The private resilience key is never returned to the client in any response.

### JWT cryptography

- Dashboard sessions: HMAC-SHA256 (`JWT_SECRET` / `JWT_ADMIN_SECRET`)
- WordPress integration: HS256 signed with `client.login.jwtSecret`, TTL 60s

---

## Background Jobs (BullMQ)

**Queue:** Redis-backed via `CACHE_REDIS_URL`

**Flow:**
```
Admin triggers via dashboard
  → POST /jobs/:jobKey/trigger
    → BullMQ Queue.add()
      → quelora-jobs worker picks up
        → executes job logic
          → writes JobExecutionLog
```

**Per-client job config** stored in `client.jobsConfig` (MongoDB). Dashboard PATCH `/jobs/:jobKey` updates config and re-schedules.

**Worker env vars:** `WORKER_CONCURRENCY`, `WORKER_MAX_JOBS_PER_SECOND`, `WORKER_MAX_RETRIES`, `WORKER_BACKOFF_DELAY_MS`

---

## WordPress Sync Contract

**Batch upsert — posts:**
```json
POST /client/{cid}/v1/nodes/batch-upsert
Authorization: Bearer {client.login.jwtSecret}
X-Client-ID: {cid}

{
  "items": [{
    "nodeId":      "post-{wpPostId}",
    "title":       "...",
    "link":        "https://...",
    "description": "excerpt",
    "tags":        ["..."],
    "categories":  ["..."],
    "language":    "en_US"
  }]
}
```

**Batch upsert — users:**
```json
POST /client/{cid}/v1/profiles/batch-upsert
Authorization: Bearer {client.login.jwtSecret}

{
  "items": [{
    "author":      "sha256({wpUserId})",
    "name":        "user_login",
    "given_name":  "...",
    "family_name": "...",
    "email":       "...",
    "picture":     "https://gravatar.url/..."
  }]
}
```

**Config fetch (setup wizard):**
```
POST /client/{cid}/v1/integration/config
Authorization: Bearer {HS256 JWT signed with jwtSecret, exp = now+60s}
```
Returns full client config object consumed by the WordPress plugin.

---

## Resilience System

**Modes:** `HYBRID` · `P2P_ONLY` · `SERVER_ONLY` · `PASSIVE`

**Adaptive triggers** (thresholds that switch mode):
- `maxEventLoopLag` (ms)
- `maxMemoryHeap` (%)
- `maxConnections`

**Peer scoring weights** (must sum to 1.0):
- `trust: 0.4` · `activity: 0.4` · `geo: 0.2`

**Keys:** ed25519 asymmetric. Private key AES-encrypted server-side, never returned. Rotated via `POST /client/:cid/resilience/generate-keys`.

---

## Environment Variable Reference

```bash
# Server
PORT=3010
BASE_URL=https://api.quelora.dev
CLIENT_URL=https://quelora.local
DASHBOARD_URL=https://dashboard.quelora.dev

# Database / Cache
MONGO_URI=mongodb://mongo:27017/quelora
CACHE_REDIS_URL=redis://redis-internal:6379
CACHE_URL=redis://redis-internal:6379

# JWT
JWT_SECRET=...
JWT_TTL=72h
JWT_ADMIN_SECRET=...
JWT_ADMIN_TTL=72h

# Encryption
ENCRYPTION_KEY=...          # AES field-level encryption for DB secrets

# Sentinel Debug Broker
INTERNAL_AI_SECRET=...      # Shared secret for Agent → Broker auth

# CID (tenant identity of this instance)
CID=QU-XXXXXXXX-XXXXX

# AI / Moderation
MODEL=gpt-4o
TEMPERATURE=0
MAX_TOKENS=1000
API_KEY=...                 # OpenAI key (default AI provider)
TOXICITY_THRESHOLD=0.7

# Google APIs
PERSPECTIVE_API_URL=https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze
PERSPECTIVE_API_KEY=...
TRANSLATE_API_URL=https://translation.googleapis.com/language/translate/v2
TRANSLATE_DETECT_API_URL=...
TRANSLATE_API_KEY=...

# Language detection
DL_API_KEY=...
DL_URL=https://ws.detectlanguage.com/0.2/detect

# Web Push
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=quelora@quelora.app

# SMTP
SMTP_HOST=postfix
SMTP_PORT=25
MAIL_TO=...

# BullMQ Worker
WORKER_CONCURRENCY=10
WORKER_MAX_JOBS_PER_SECOND=5000
WORKER_MAX_RETRIES=3
WORKER_BACKOFF_DELAY_MS=1000
WORKER_REMOVE_COMPLETED_JOBS=true
WORKER_REMOVE_FAILED_JOBS=1000

# Rate limiting
LIMIT_COMMENTS=15
DEFAULT_LANGUAGE=es

# Seeding (optional)
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=...
REDDIT_PASSWORD=...
GIPHY_API_KEY=...
GIPHY_SEARCH_URL=https://api.giphy.com/v1/gifs/search
```

---

## Shared Packages

| Package | What it provides |
|---------|-----------------|
| `@quelora/common` | Models, DB connection, authService, cacheService, emailService, pushService, moderateService, toxicityService, cipher utils, requestLogger, globalErrorHandler, responseCompressor, rate limiters |
| `@quelora/enterprise` | Optional gamification, ads, surveys modules (feature-flagged per user via `enterpriseModules`) |

---

## Common Developer Tasks

**Add a new route:**
1. Create handler in the appropriate controller.
2. Register in the matching `routes/*.js` file with the correct auth middleware.
3. If it's an admin operation, wrap with `checkRole(['admin', 'god'])`.
4. If it mutates data, the `cacheInvalidator` middleware auto-invalidates Redis cache.

**Add a new background job:**
1. Add job definition to `CLIENT_JOB_DEFS` (key, label, default cron, params schema).
2. Implement job logic in `quelora-jobs` worker package.
3. Add locale keys in all `locale/*.json` for `jobs.config.{key}.label` and `.desc`.

**Extend client configuration:**
1. Add field to Client schema in `@quelora/common`.
2. If sensitive, add encryption/decryption to `Client.js` model methods.
3. Expose getter/setter in `clientConfigService`.
4. Add route + controller if admin-editable.

**Debug a live session with Sentinel:**
1. Open WordPress site, trigger Sentinel from the browser.
2. Note the 6-char hex PIN.
3. Run Node.js client from `apps/` (not from `quelora-dashboard-api/`), requiring `./node_modules/ws`.
4. Send `JOIN_SESSION` with PIN + `INTERNAL_AI_SECRET`.
5. Use `EXEC_JS` commands to inspect DOM, computed styles, or execute arbitrary JS.

**Test sync endpoints without WordPress:**
```bash
curl -X POST https://api-dashboard.quelora.dev/client/{cid}/v1/nodes/batch-upsert \
  -H "Authorization: Bearer {client.login.jwtSecret}" \
  -H "X-Client-ID: {cid}" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"nodeId":"post-1","title":"Test","link":"https://example.com","description":"...","tags":[],"categories":[],"language":"en"}]}'
```

---

## Security Notes

- All admin AJAX endpoints require valid `JWT_ADMIN_SECRET` token + role check.
- `quelora_refresh_token` equivalent (`/auth/renew-token`) requires existing valid token.
- Body size capped at 25 MB globally; file uploads additionally MIME-filtered.
- `validateCidAccess()` in `utils/accessControl.js` enforces multi-tenancy — always use it when a controller receives a CID from the URL.
- Private resilience keys (`ed25519`) are encrypted at rest and never returned in any API response.
- Puppeteer runs with `--no-sandbox` — must be containerized (already the case in the Docker Compose stack).
- Redis has no password by default — assumed internal Docker network only.
