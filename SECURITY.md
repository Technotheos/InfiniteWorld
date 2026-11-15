
# Security

This document describes how authentication and the WebSocket engine are secured in Learn Block, how to configure them, and what is **not** covered yet.

Relevant files: `auth.go`, `ws.go`, `main.go`.

---

## Configuration

All secrets and deployment settings come from environment variables. **Nothing sensitive is stored in the source code.**

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | HMAC signing key, at least 32 characters. The server refuses to start without it. Generate one with `openssl rand -base64 48`. |
| `ALLOWED_ORIGINS` | For browsers | Comma-separated list of allowed web origins, e.g. `https://app.example.com,http://localhost:5173`. Used for both CORS and the WebSocket origin check. |
| `ADDR` | No | Listen address. Default `:8080`. |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | No | If both are set, the server serves HTTPS/WSS directly. Otherwise run it behind a TLS-terminating reverse proxy. |

Example (`.env` is git-ignored, never commit it):

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
export ALLOWED_ORIGINS="http://localhost:5173"
go run .
```

---

## Authentication (REST)

| Endpoint | Method | Body (form-encoded) |
|---|---|---|
| `/api/signup` | POST | `username`, `password`, `email` (optional) |
| `/api/login` | POST | `username`, `password` |

Login returns:

```json
{ "token": "<jwt>", "username": "alice", "expires_in": 900 }
```

Errors are returned as `{"error": "message"}`.

### Rules

- **Username:** 3-32 characters, `a-z 0-9 _ . -` (lower-cased and trimmed).
- **Password:** 12-72 bytes (72 is bcrypt's hard limit).
- **Email:** optional, validated, max 254 characters.
- Credentials are read from the **request body only**, never the URL query string.

### Protections

- **Password hashing:** bcrypt, cost 12. Hashing happens outside the user-store lock so slow hashes can't block other requests.
- **User enumeration:** login always runs a bcrypt comparison (against a dummy hash for unknown users) and returns one generic error, so neither the message nor the response time reveals whether a username exists.
- **Brute force:**
  - Per-IP rate limit: 30 auth requests/minute.
  - Per-username lockout: 5 failed logins locks the username for 15 minutes (tracked for unknown usernames too).
- **Request limits:** bodies are capped at 8 KB.
- **IDs:** user IDs are random 128-bit values, not the username.
- **Responses:** built with `encoding/json` (no string concatenation), plus `Cache-Control: no-store`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a restrictive CSP and HSTS.
- **CORS:** explicit origin allowlist. `Access-Control-Allow-Origin: *` is never used.
- **Client IP:** taken from the TCP connection, not from `X-Forwarded-For` (which clients can spoof).

---

## JWT

- Algorithm: **HS256 only**. Tokens using any other algorithm (including `none`) are rejected.
- Required/validated claims: `exp`, `iss`, `aud`. Also issued: `sub` (user ID), `iat`, `nbf`, `jti`.
- Lifetime: **15 minutes** (`tokenTTL` in `auth.go`), with 30 seconds of clock leeway.
- Protected HTTP routes can use `AuthMiddleware`, which also checks that the user still exists.

---

## WebSocket (`/ws`)

### Connecting

Tokens are **no longer accepted in the URL** (`?token=...`), because URLs are written to server, proxy and browser logs.

Browser:

```js
const ws = new WebSocket(`wss://host/ws?room_id=${room}`, ["bearer", token]);
```

Non-browser clients can send `Authorization: Bearer <token>` instead.

### Protections

- **Origin check:** browser connections must come from `ALLOWED_ORIGINS` (prevents cross-site WebSocket hijacking). Clients that send no `Origin` header (CLI, mobile) are allowed but still need a valid JWT.
- **Token lifetime:** the socket is closed when the JWT that authorised it expires.
- **Spoofing:** `sender` and `room_id` are always set by the server, never trusted from client messages.
- **Room IDs:** must match `^[A-Za-z0-9_-]{1,64}$`.
- **Message limits:** 4096 bytes per message (`SetReadLimit`), `action` max 32 characters, 5 messages/second per connection (burst 10), after which the connection is closed.
- **Connection limits:** 60 connection attempts/minute per IP, 5 connections per user, 100 clients per room, 1000 rooms total. Empty rooms are deleted.
- **Liveness:** ping/pong heartbeat with read and write deadlines, so dead connections are dropped.
- **Slow clients:** a client that can't keep up is disconnected rather than stalling the room.

### HTTP server

`main.go` uses `http.Server` with header/read/write/idle timeouts (slowloris protection), a 16 KB header limit and graceful shutdown. These timeouts stop applying after a connection is upgraded to a WebSocket; `ws.go` manages its own deadlines.


# Security: additions

This adds sessions, roles/IAM, an audit log, SSRF and XSS defences and stricter
origin handling. Everything below is implemented and covered by tests; the last
two sections say how it was verified and what is **not** covered.

Relevant files: `sessions.go`, `iam.go`, `admin.go`, `audit.go`, `netsec.go`,
`safefetch.go`, `textsafe.go`, `store_iam.go`, `db/migrations/000003_*`,
`frontend/src/session.ts`, `frontend/vite.config.ts`.

## Changes to existing sections

| Existing statement | Now |
|---|---|
| Login returns only a token | It also sets the `iw_rt` refresh cookie (HttpOnly). The access token is kept **in memory** by the app, not in `localStorage`. |
| Per-IP rate limit: 30 auth requests/minute | 30/min for login, signup and refresh. Requests that already carry a valid login get a separate 300/min budget, so people sharing an address are not locked out. |
| Per-username lockout: 5 failures | Lockout is per **username + IP** (5 failures), so a stranger cannot lock you out. A higher per-username ceiling (30) still stops distributed guessing. |
| Client IP is never taken from `X-Forwarded-For` | Still true by default. If `TRUSTED_PROXIES` is set, the header is believed **only** when the direct peer is on that list (see below). |
| `AuthMiddleware` checks the user still exists | It also checks the account is not disabled, is the same account (`sub`), and that the token predates no "log out everywhere" (`tv`). |
| Socket closes when its token expires | Unchanged, but a client can renew in-band (`reauth`), so a game or chat is not cut every 15 minutes. |
| `ALLOWED_ORIGINS` accepts any list | Entries are validated at startup (see Origins). |

## Configuration (new)

| Variable | Default | Description |
|---|---|---|
| `COOKIE_SECURE` | `true` | `false` only to test over plain http on a LAN address (see Pitfalls). Never in production. |
| `ADMIN_ALLOWED_CIDRS` | `127.0.0.1/32,::1/128` | IPs/ranges that may reach `/api/admin/*`. Anyone else gets a plain 404. |
| `TRUSTED_PROXIES` | empty | Reverse proxies whose `X-Forwarded-For` is believed. **Required behind nginx/Caddy/Cloudflare**, otherwise every visitor shares the proxy's IP (breaking rate limits and the admin allowlist). |
| `OUTBOUND_ALLOWED_HOSTS` | empty | Hosts server code may fetch (SSRF guard). Empty = no outbound fetches at all. |
| `VITE_API_URL`, `VITE_WS_URL` | `http://localhost:8080`, derived | Build-time. The production build's CSP allows exactly these hosts. |

A malformed `ALLOWED_ORIGINS`, `TRUSTED_PROXIES` or `ADMIN_ALLOWED_CIDRS` stops
the server from starting rather than silently widening access.

Apply the new migration: `docker compose run --rm migrate` (`000003_security_iam`).

## Sessions

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, 15 min | 256-bit random value |
| Stored by the app | In memory only | HttpOnly cookie `iw_rt`, `Secure`, `SameSite=Strict`, `Path=/api/auth` |
| Readable by JavaScript | Only inside the app's own code | **Never** |
| Stored on the server | nothing | SHA-256 hash only |

- **Stay signed in:** on page load the app calls `POST /api/auth/refresh`; the
  browser sends the cookie and gets a fresh access token. The app renews again a
  minute before each expiry.
- **Rotation + reuse detection:** every refresh replaces the refresh token. If an
  already-used token is presented again later (stolen or replayed), the **whole
  chain is revoked** and the event is audited (`auth.refresh_reuse`). Two tabs
  refreshing within 10 seconds are treated as a race (HTTP 409, the app retries),
  not an attack.
- **Lifetimes:** 14 days per refresh token, with an absolute cap of 60 days per
  chain however often it is used.
- **Log out everywhere / password change / disable:** these bump
  `users.token_version` and revoke every refresh token. Outstanding access
  tokens stop working **immediately**, not after 15 minutes. A password change
  then signs the current device back in.
- **Account binding:** tokens are bound to the user's ID. A renamed username that
  someone else registers cannot be used with the old owner's token.
- **CSRF:** the cookie endpoints (`/api/auth/refresh`, `/logout`) require a known
  `Origin` header; the cookie is `SameSite=Strict`; CORS credentials are only
  offered to allowed origins.
- **Devices:** Settings lists signed-in devices and can sign any of them out.

Endpoints: `POST /api/auth/refresh`, `POST /api/auth/logout`,
`POST /api/auth/logout-all`, `GET /api/auth/sessions`,
`POST /api/auth/sessions/revoke`.

**WebSockets** keep using the `["bearer", token]` subprotocol. When the session
renews, the app sends `{"type":"reauth","payload":"<token>"}` (game) or
`{"action":"reauth","content":"<token>"}` (chat) over the open socket. The new
token gets full validation and **must belong to the same account**; otherwise the
server closes the socket with 1008.

## IAM

| Role | Permissions |
|---|---|
| `user` | none (normal app use) |
| `moderator` | `users.read`, `users.disable`, `sessions.revoke` |
| `admin` | all of the above plus `users.role.set`, `audit.read` |

Handlers check **permissions**, not role names, so adding a role is a one-line change.

Rules enforced on every admin action:

1. Nobody can act on their own account (no self-promotion, no self-lockout).
2. You can only act on accounts of a strictly lower rank (moderators cannot touch
   moderators or admins; admins cannot touch other admins through the API).
3. **The admin role is granted and removed only from the server console**, never
   through HTTP, so a stolen admin session cannot create more admins:

```bash
cd backend-go
set -a; . ../.env; set +a        # same environment as run.sh (database + JWT_SECRET)
go run . promote <username>     # make an admin (use this once to bootstrap)
go run . demote  <username>     # refuses to remove the last active admin
```

The running server caches account state for up to 5 seconds, so a console change
can take that long to show up.

Admin API (all POST except the GETs; every route needs a valid token, the
permission above, **and** an IP on `ADMIN_ALLOWED_CIDRS`):

`GET /api/admin/users?q=&after=&limit=`, `POST /api/admin/users/role`
(`user`/`moderator` only), `/disable`, `/enable`, `/revoke`,
`GET /api/admin/audit?action=&user=&before=`.

Disabling an account revokes its sessions immediately, and the account is refused
at login. The Admin console lives in Settings, only for staff.

## Audit log

Append-only table `audit_log`. A database trigger rejects `UPDATE`, `DELETE`
and `TRUNCATE`, so even application code cannot rewrite history.

Recorded: sign-ups, sign-ins (success and failure, lockouts), sign-outs, logout-all,
device sign-outs, refresh-token reuse, password and username changes, failed
password confirmations, every admin action, every denied admin attempt (wrong role
or wrong network), console promote/demote. Each event has actor, target, IP,
user agent and a small JSON detail.

Never recorded: passwords, tokens, or text typed into the username box on a failed
login (stored as `(invalid)` so a mistyped password cannot leak into the log).

## Origins, CORS and CSRF

- `ALLOWED_ORIGINS` entries must be `scheme://host[:port]`: no wildcards, no
  `null`, no paths or credentials. `http://` is accepted only for `localhost` and
  private-network addresses.
- Every state-changing request that names an unlisted `Origin` is refused (403),
  in addition to CORS. A request with the same host as the API is treated as
  same-origin, so serving app and API from one domain works without listing it.
- `Vary: Origin` is always sent; credentials are only offered to listed origins;
  preflights from other origins get 403.
- Admin routes: IP allowlist (`ADMIN_ALLOWED_CIDRS`) plus a 404 for outsiders.

## SSRF

Nothing in the server fetches user-supplied URLs today (avatars are uploaded
bytes, not links), so there is no live hole. `safefetch.go` exists so the first
feature that needs one (link previews, avatar-by-URL, webhooks) cannot open one.
**All such fetches must go through it**:

```go
res, err := outboundFetcher().Get(ctx, userSuppliedURL)
```

All layers must pass: host on `OUTBOUND_ALLOWED_HOSTS` (deny by default); `https`
and port 443 only; no credentials, no IP-literal hosts, no look-alike Unicode
hosts; and the connection is checked **after DNS resolves**, against loopback,
private, link-local (including the cloud metadata address `169.254.169.254`),
CGNAT, multicast, IPv4-mapped IPv6, NAT64 and 6to4 ranges (which defeats DNS
rebinding); redirects limited to 3 and each hop re-validated; environment proxies
ignored; response size capped (1 MiB) and time-limited (5 s).

## XSS

- React escapes everything it renders, and there is **no** `dangerouslySetInnerHTML`,
  `innerHTML`, `eval` or `document.write`. `frontend/scripts/security-check.mjs`
  fails CI if any of them (or token-in-storage / token-in-URL / token logging)
  appears.
- **Content-Security-Policy** is injected into the production build:
  `script-src 'self'` (no inline or third-party scripts), `object-src 'none'`,
  `base-uri 'none'`, `connect-src`/`img-src` limited to your API. Scripts from
  anywhere else, and inline script injection, are blocked by the browser.
- The login token is not in `localStorage`, and the long-lived cookie is HttpOnly,
  so an XSS bug cannot steal a lasting credential.
- User-visible text (bios, chat, admin reasons) has control characters, bidi
  overrides (Trojan Source), zero-width characters and line separators removed or
  rejected (`textsafe.go`).
- Avatars are decoded and re-encoded server-side (drops metadata and any appended
  payload), served with `nosniff` and a locked-down CSP.

## SQL injection

Every query passes user input as `$1`, `$2`… parameters. `TestNoSQLBuiltFromStrings`
parses the Go source and fails if SQL text is not a string literal, or is built
with `fmt.Sprintf` or `+`. Search uses `starts_with()`, so `%` and `_` in a query
are literal. Fields are also validated by allowlist regexes before reaching the
database, and the schema has `CHECK` constraints (role values, lengths).

## Other fixes made while doing this

- **Chat sockets were broken:** the chat hook sent the token in the URL, which the
  server (correctly) rejects. It now uses the subprotocol. It also logged the full
  URL, including the token, to the browser console; removed.
- Chat message content is sanitised server-side before being relayed.
- Removed the unused legacy `roomView.tsx`, which stored a token in `localStorage`
  and put it in the WebSocket URL.
- Authenticated and unauthenticated traffic have separate rate-limit budgets;
  lockout no longer lets a stranger lock out a real user.
- WebSocket URLs are derived from `VITE_API_URL` instead of a hard-coded
  `ws://localhost:8080`.

## Deployment checklist

1. **Serve over HTTPS.** Run behind a TLS reverse proxy or set `TLS_CERT_FILE` /
   `TLS_KEY_FILE`. Without TLS, tokens and passwords are readable on the network.
2. Set `ALLOWED_ORIGINS` to your real `https://` origin(s), and build the frontend
   with `VITE_API_URL` pointing at the API.
3. Behind a proxy, set `TRUSTED_PROXIES` to its address; set `ADMIN_ALLOWED_CIDRS`
   to your own network (or VPN).
4. Send these headers from the web server that serves the frontend (a `<meta>`
   tag cannot set `frame-ancestors`):

```caddyfile
header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "frame-ancestors 'none'"
}
```

5. Create your first admin: `go run . promote <username>`.
6. Database: use `sslmode=require` (or `verify-full`) for any non-local database,
   and give the app a role with only `SELECT/INSERT/UPDATE/DELETE` (no DDL, not a
   superuser); run migrations with a separate owner role.
7. Back up the database, and decide how long to keep `audit_log` (the trigger
   blocks deletes; pruning needs a maintenance role that can drop it).

## Pitfalls

- **Phone / LAN testing over plain `http://`:** a `Secure` cookie on a non-localhost
  http address is silently dropped by the browser, so login works but every reload
  logs you out. For that testing only, set `COOKIE_SECURE=false` and
  `ALLOWED_ORIGINS=http://<your-lan-ip>:5173`. `localhost` works with the default.
- **The app and API must be the same site** (same host or sibling subdomains,
  ports don't matter) because the cookie is `SameSite=Strict`.
  `localhost` and `127.0.0.1` count as different sites; use one consistently.
- The development server (`npm run dev`) has no CSP, so it can run hot reload;
  the CSP applies to `npm run build` / `vite preview`.

## How this was verified

- **Go: 76 tests, all passing**, including a real PostgreSQL 16 for the SQL
  (rotation transaction, reuse detection, revocation, the append-only trigger,
  cross-user isolation, paging and `LIKE` safety). They skip the PostgreSQL ones if
  `TEST_DATABASE_URL` is not set.
- **Mutation checks:** a deliberately vulnerable query was planted and the SQL guard
  caught all three patterns; removing the same-account check on socket renewal made
  its test fail.
- **Real browser, real server, real database** (production build with CSP): login
  and reload, no token in web storage, cookie flags, avatar upload, two devices,
  password change, console promote, admin disable/audit, disabled-account login
  refusal, chat sockets, logout-everywhere, and **zero CSP violations**.
- **Token expiry:** with a 70-second token, a chat and a game socket each stayed on
  one connection across the expiry (chat across two), proving the in-band renewal.
- Migration `000003` was applied, rolled back and re-applied cleanly.

## Not covered (be aware)

- **Single server only.** Rate limits, lockouts and the 5-second auth cache live in
  memory; they reset on restart and would not be shared across several instances.
  Use Redis if you scale out.
- **Revocation vs open sockets:** after "log out everywhere" or a disable, an
  already-open socket stays up until its own token ends (at most 15 minutes), but
  it cannot renew and every new request is refused at once.
- **No MFA, no email verification, no password reset.** There is no way to recover
  a forgotten password. Admin role changes do not ask for the password again
  (step-up authentication).
- **CSP uses `'unsafe-inline'` for styles** (Tailwind and animation libraries need
  it); scripts are strict.
- Avatars are public by username (needed for `<img>` tags).
- `govulncheck` and `npm audit` run in CI (`.github/workflows/security.yml`); they
  could not be run in the environment this was built in because it cannot reach the
  vulnerability databases.
- No penetration test by a third party; this is a code review plus automated tests.
