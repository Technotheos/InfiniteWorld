# room-engine

A real-time room app with authentication and WebSockets, built as an alternative to the fakeness of social media.

> ⚠️ **Status: early development.** Not production ready. Dev credentials in the code are for local use only.


i am just tired of this social media, and how fake it is.
i am also tired of my laziness, i hate wasting time even though i do it all the time, but i want to change that, through building a revolutionary web app, that has a new, creative idea with robust, efficient, and secure engineering. i am not a senior engineer or elite security researcher yet, i am just a curious kid who wants to build things to see systems at a lower and multi layered levels.



`` let's see where this project takes us `` 


## Frontend & Design

The UI uses a dark, celestial theme built with React, TypeScript and Tailwind.

- **Interactive starfield** (`Starfield.tsx`): a canvas background with parallax depth that follows the cursor, constellation lines near the pointer, occasional shooting stars, and a hyperspace "warp" effect. It is sharp on high-DPI screens and respects `prefers-reduced-motion`.
- **Auth pages** (`Login.tsx`, `Signup.tsx`, `AuthShell.tsx`): a glass card that tilts toward the cursor with a pointer-following spotlight, an orbiting logo, glowing inputs, a show/hide password toggle and a password strength meter. A successful login plays the warp animation.
- **Dashboard** (`Home.tsx`): animated room cards with cursor spotlights, a "Random Adventure" button that warps you into a random room, and an engine status badge that takes real connection state.
- **Auth client** (`authApi.ts`): shared API base URL (`VITE_API_URL`) and error handling. Forms validate input client-side using the same rules as the server and show the server's error messages.
- **Accessibility:** labelled inputs, `autocomplete` attributes, focus rings, `role="alert"` on errors, and semantic `nav` / `main` landmarks.


## Configuration & Security

Set these environment variables before running:

- `JWT_SECRET` (required, 32+ chars)
- `ALLOWED_ORIGINS` (e.g. `http://localhost:5173`)

See [SECURITY.md](SECURITY.md) for the full security model and known limitations.

**WebSocket clients:** connect with `new WebSocket(url, ["bearer", token])`. Tokens in the URL are no longer accepted.


## Tech stack

- **Go:** auth, and WebSocket server
- **FastAPI:** Python service *(in progress)*
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Database:** PostgreSQL
- **Infra:** Docker, Docker Compose, redis,...(for later, only added complexity now)



**Embo, the mascot** (`src/mascot/`): a cute fire slug that lives at the bottom
  of the screen. It wanders around, waves, juggles sparks, trips over nothing,
  cracks jokes in speech bubbles and falls asleep if you leave it alone. Its eyes
  follow the cursor, and poking it repeatedly gets increasingly dramatic reactions.
  It is drawn in SVG and animated with CSS, so it adds no extra dependencies, and it
  respects `prefers-reduced-motion`. You can hide it with the × button, and that
  choice is remembered.
  
 It's a great interative component in the app, it literally gives a soul to the environment. i thought about making it like an orca, but that sunny character was convenient with the celestial background. please feel free to share you designs or ideas at any level to improve the mascot, the app, and the engineering of this entire app.

  Other components can make Embo react to what is happening in the app:

  ```tsx
  const mascot = useMascot();
  mascot.say("Nice one!");
  mascot.react("cheer", "You won!"); // poses: wave, cheer, sad, surprised, trip, dizzy, juggle, sleep
  ```


 ## Persistence: PostgreSQL

Accounts survive restarts. Users and password hashes live in PostgreSQL, and the Go API talks to it through a small storage layer (`backend-go/store.go`).

### What's in the box
- **Storage layer:** a `UserStore` interface (`Create`, `ByUsername`, `Exists`) with two implementations: `pgStore` (PostgreSQL via `pgx/v5` + `pgxpool`) and `memoryStore` (tests and throwaway dev runs).
- **Schema:** `db/migrations/000001_users_and_sessions.up.sql`. The users table has a UUID primary key, a unique lowercase username, a nullable unique email and a bcrypt hash. The DB constraints mirror the Go validation rules, so the database is a second line of defence.
- **Auth path:** signup and login go through the store. Every JWT-protected route and WebSocket upgrade also checks that the user still exists (with a 30 s positive cache to spare the database). If the database errors, the check fails closed.
- **Security posture unchanged:** bcrypt cost 12, uniform login timing for unknown users, per-user lockout, HS256 JWTs with a 15-minute TTL.

### Hardening details
- All queries are parameterised, so there is no string-built SQL.
- Unique violations map to `409`. Other DB errors return `500`/`503` and are never reported as "wrong password".
- The pool is capped at 10 connections, with 3 s per-query timeouts and periodic health checks.
- On boot the server retries the connection for about 20 s, then checks that migrations were applied and refuses to start if not.
- The server will not silently fall back to in-memory users. With no database configured it exits, unless you set `ALLOW_MEMORY_STORE=1`.

### Docker
`docker-compose.yml` runs Postgres 15 (alpine) bound to `127.0.0.1:5432` only, with a named volume (`pgdata`), a healthcheck and credentials from `.env`. A one-shot `migrate` service applies `db/migrations`. The Go API and the frontend still run on the host; `backend-go/Dockerfile` is empty.

### Run it
```bash
docker compose up -d postgres
docker compose run --rm migrate

cd backend-go
set -a; . ../.env; set +a        # Go does not read .env on its own
export JWT_SECRET="..."          # >= 32 chars; keep it stable between runs
go run .                         # expect: "PostgreSQL connected"
```

Config: `DATABASE_URL`, or `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (+ optional `POSTGRES_HOST`, `POSTGRES_SSLMODE`). The default is `sslmode=disable`, which is fine on loopback. Use `require` or `verify-full` for remote databases. See `.env.example`.

### Tests
```bash
cd backend-go
TEST_DATABASE_URL='postgres://USER:PASS@127.0.0.1:5432/DB?sslmode=disable' go test ./...
```
These cover the store round-trip, duplicate username and email handling, and signup → server restart → login. Without `TEST_DATABASE_URL` the database tests skip themselves.

### Not persisted yet
Refresh tokens (the table exists, no flow yet), lab progress (`localStorage`), chat history, game results. The login lockout and the rate limiter are in memory and reset on restart.