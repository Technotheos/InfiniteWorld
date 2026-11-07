# Rooms: maps, missions, and a server that referees

A **room** is a *map* (an ordered list of missions, as JSON) run by a **server-authoritative
referee**. Players send intentions ("I clicked", "my text so far is..."). The server decides what
they mean, times them, scores them, and ranks the result. New room types are new JSON files.

Included rooms (`backend-go/maps/`):

| Map                     | Mode        | Missions                                                                    |
| ----------------------- | ----------- | --------------------------------------------------------------------------- |
| `arena` Quick Arena     | versus, 1-8 | Reflex (reaction), Math Sprint, Type Storm                                  |
| `cipher-lab` Cipher Lab | versus, 1-8 | Caesar, Base64, Hex, Binary (each teaches what the encoding really is)      |
| `spark` Social Spark    | co-op, 2-6  | 3 conversation missions; the team wins only if everyone agrees each is done |
|                         |             |                                                                             |

## Wire it up

**backend-go**: copy `game_*.go` and `maps/`, then in `main.go` (after `InitAuth()`):

```go
hub, err := NewGameHub()
if err != nil { log.Fatal(err) }
hub.Register(mux) // /api/maps, /api/rooms, /api/rooms/quick, /ws/game
```
No new dependencies. It reuses your `ValidateJWT`, `AuthMiddleware`, `withSecurity`, `upgrader`, `wsLimiter`,
`newBucket` and constants. If `go build` reports a duplicate name, one of mine collides with a file I have not seen.

**frontend**: copy `src/game/`. Needs React 18, TypeScript 5, Vite. Set `VITE_API_URL` (and `VITE_WS_URL` if different).

```tsx
<Route path="/play"       element={<RoomPicker token={token} onEnter={(c) => navigate(`/play/${c}`)} />} />
<Route path="/play/:code" element={<GameRoom code={code} token={token} onLeave={() => navigate("/play")}
                                              onAuthExpired={logout} />} />
<Route path="/dev/rooms"  element={<Preview />} />  {/* every screen, no backend needed */}
```

## Protocol (v1)

`server -> client: {"v":1,"type":"hello|state|chat","payload":...}`  `client -> server: {"type":...,"payload":...}`

| Client sends | Meaning |
|---|---|
| `ready {ready}` / `start` | lobby: toggle ready; host starts early |
| `act {op,...}` | mission action: `click`, `answer {value}`, `progress {typed}`, `done {value}` |
| `chat {text}` | max 200 chars, 0.7 s cooldown |
| `rematch` | after a game: back to the lobby |

The server sends a full per-player `state` snapshot on every change (progress bars at most 5/s).
Private data (your current math question) only goes to you. Phases: `lobby > countdown > briefing > playing > reveal > ... > finished`.
Deadlines are server unix ms; `state.now` lets the client correct clock skew.

## Scoring

Each mission reports a raw number per player; the room converts it to **0-1000 relative to the best player**,
so a reaction test and a typing test weigh the same. Total = sum. Ties share a place.
Co-op maps ignore ranking: the team wins if every mission completed.

## Add a room (no Go needed)

Drop `maps/my-room.json`. Unknown fields and bad values fail at startup, not mid-game.
```json
{ "id": "duel", "name": "Duel", "tagline": "Two players, two games.", "theme": "aurora", "mode": "versus",
  "min_players": 2, "max_players": 2,
  "missions": [ { "kind": "math", "title": "Fast Maths", "brief": "...", "duration_ms": 20000 },
                { "kind": "cipher", "variant": "hex", "title": "Hex", "brief": "...", "rounds": 3, "duration_ms": 25000 } ] }
```
Kinds: `reaction` `math` `typing` `cipher` `talk`. Themes: `nebula` `matrix` `aurora`.

## Add a mission kind

1. Go: implement the `Mission` interface in `game_missions.go` (Start, Handle, Tick, Public, Private, Raw, Stats, Note) and register it in `newMission` and `knownKinds`.
2. React: add `missions/YourMission.tsx` and one `case` in `GameView.tsx`; add its types to `types.ts`.

## What is enforced server-side

Auth on every socket (JWT as subprotocol, never in the URL; the socket closes when the token expires) · all state, timing and
scores live in one goroutine per room (no locks, no shared state) · 12 actions/s per connection, 4 KB frames · 200 rooms,
8 players, 20 spectators · identity comes from the token, never from the message · typing faster than 22 chars/s is rejected
(paste or script) · a client that cannot keep up is dropped, never allowed to stall the room · empty rooms are freed.

## Honest limits

- Reaction is timed by the server on message arrival, so network latency is included for everyone (fair on average, not exact).
- Nothing is persisted: rooms and scores live in memory and vanish on restart; one server instance only (same as `ws.go` today).
- Same unchanged caveats as before: tokens last 15 min with no refresh flow; `clientIP` is the TCP peer, so behind a proxy all users share one IP.
- No moderation tools yet (report / mute / kick). Add them before opening rooms to strangers.
- The UI was type-checked, built, and every screen server-rendered, but I had no browser to look at it. Open `/dev/rooms`.

## Tests

```bash
cd backend-go && go test -race ./...                        # 17 tests: rules per mission, bots playing a full game, auth, limits
cd frontend   && npx vite-node src/game/dev/smoke.tsx       # renders all 14 screens and checks their content
```

## Next

Persist results in Postgres (`rooms`, `results`) · token refresh · report/mute/kick · more missions (trivia, word chain, drawing) ·
voice via LiveKit · a 3D skin that reads the same `state`.
