# quelora-dashboard-api

**Admin API for the [Quelora](https://github.com/Quelora) platform.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

Multi-tenant administration backend. Serves the Quelora dashboard SPA, the
WordPress plugin sync endpoints, and the Sentinel debug broker. Listens on
port **3010**.

## Features

- **RBAC** — role hierarchy (god → admin → editor → moderator → advertiser → analyst → user)
- **Client management** — tenant CRUD, per-client configuration, module/plugin activation
- **Content & moderation** — posts, comments, reports, ban/unban, moderation testing
- **Analytics** — system, geo, post, profile and moderation statistics
- **Reputation** — per-client weights, trust levels, audit log
- **Jobs** — schedule and trigger BullMQ background jobs
- **Auth** — JWT sessions, 2FA (TOTP), account lockout
- **WordPress sync** — batch upsert of posts and profiles
- **Sentinel** — WebSocket debug broker at `/ws/debug-broker`

## Requirements

- Node.js 20+ · MongoDB 4.4+ · Redis 6+

## Setup

```bash
npm install
cp .env.example .env      # fill in your values
npm start
```

See `.env.example` for the full configuration reference.

## Architecture

Depends on [`@quelora/common`](https://github.com/Quelora/quelora-common).
Consumed by [`quelora-dashboard`](https://github.com/Quelora/quelora-dashboard)
(the React admin SPA).

## License

[AGPL-3.0-only](./LICENSE) — Copyright (C) 2026 Germán Zelaya.

Part of the **[Quelora](https://github.com/Quelora)** project.
