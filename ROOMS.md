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
| `brain-bazaar` Brain Bazaar | versus, 1-8 | Estimate It, Fact or Fib, Chain Reaction: bet coins on your own answers      |
| `midnight-mystery` Midnight Mystery | versus, 4-6 | Two generated 3D crime cases with secret roles (culprit, detective, witness, trickster) |
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
Kinds: `reaction` `math` `typing` `cipher` `talk` `bazaar` `mystery`. Themes: `nebula` `matrix` `aurora` `bazaar` `noir`.

## Add a mission kind

1. Go: implement the `Mission` interface in `game_missions.go` (Start, Handle, Tick, Public, Private, Raw, Stats, Note) and register it in `newMission` and `knownKinds`.
2. React: add `missions/YourMission.tsx` and one `case` in `GameView.tsx`; add its types to `types.ts`.

## Brain Bazaar and Midnight Mystery

Both are ordinary mission kinds (`game_bazaar.go`, `game_mystery.go`) with 3D scenes in `frontend/src/game/three/`
(three.js, loaded lazily the first time one of these rooms opens; no WebGL means the normal UI still works).

**bazaar** (`variant`: `estimate` | `fib` | `chain`, `rounds` = questions, `duration_ms` = time per question).
`act {op:"answer", value, bet}` with `bet` 1-3 (stake 50/100/200). Estimate: bullseye pays 2x, close 1x, far off loses the
stake. Fib/chain: right pays the stake plus a speed bonus, wrong loses it. Random market events: bull (wins x2),
crash (losses x2), tip (a hint). The biggest loser of a round gets a Wacky Penalty. Questions live in `game_bazaar_bank.go`.

**mystery** (`variant`: `museum` | `lab` | `liner`, empty = random; `duration_ms` = length of the interrogation phase).
Phases: intro > alibi > investigate > interrogate > vote > unmask. The case is generated per game and `solvable()` proves
it can be cracked by logic: honest players' testimony never contradicts itself, while the culprit's lie about the crime
window names two innocents who each contradict it. Actions (`act`): `inquire {room,slot}` (private camera reading),
`verify {target,slot}` (detective only, public), `tip {target?}` (witness: true, culprit/trickster: planted), `press {target,slot}`,
`vote {target}`. Roles are private (`state.private`); the truth only appears in `play.unmask` after the vote.
New cases: add a theme to `mysteryThemes` in `game_mystery.go`.

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
cd backend-go && go test -race ./...                        # incl. game_rooms_new_test.go (bazaar + mystery): rules per mission, bots playing a full game, auth, limits
cd frontend   && npx vite-node src/game/dev/smoke.tsx       # renders all 14 screens and checks their content
```

## Next

Persist results in Postgres (`rooms`, `results`) · token refresh · report/mute/kick · more missions (trivia, word chain, drawing) ·
voice via LiveKit · a 3D skin that reads the same `state`.

# Starship Studio

A music and production lab: a shared step sequencer, voice booth, take timeline and listening lounge.

| Where | What |
|---|---|
| `frontend/src/studio/StudioDoorway.tsx` | The card on Home: waveform-to-pulsar ring, 90 BPM breathing, equalizer, tagline, "N producers on air", friend moons, sealed/open iris |
| `frontend/src/studio/StudioLab.tsx` | Lobby: quick join, new public/private studio, code, invites |
| `frontend/src/studio/Deck.tsx` | The room. `BeatBay`, `Booth`, `Mixer`, `Lounge` are its panels |
| `frontend/src/studio/audio.ts` | Synth, beat-locked scheduler, take looper, generated house loops, recorder |
| `backend-go/studio_room.go` | Server-authoritative room: sequencer, transport, roles, rec state, host controls, queue, publish consent |
| `backend-go/studio_http.go` | Endpoints, WebSocket, upload, signed media, reports, takedown |
| `backend-go/studio_audio.go` | Upload pipeline, storage, signing, retention |

## How the shared clock works
The server stores `(epoch, offset, bpm)`. Every client measures its offset to the server clock with ping/pong
(smallest round trip wins) and computes the same beat. Lights read `--b`, one CSS variable set on each beat.
Takes are snapped by the **server** to the beat on which the producer pressed Record.

## Security map (your list, and where each item lives)
**Uploads**: magic bytes (`sniffAudio`), size / duration / quota / rate caps, ffprobe codec + container check,
ffmpeg re-encode to AAC/MP4 with `-map_metadata -1`, one audio stream, `-protocol_whitelist file`, empty environment,
`ulimit` CPU / memory / file size, hard timeout and `unshare -rn` (no network) when the host allows it,
random 128-bit IDs, `STUDIO_DATA_DIR` (0700), signed 60 s URLs bound to item + user, membership re-checked on every
fetch, `nosniff` + `Content-Disposition: attachment`, ClamAV via `clamdscan`, 5-minute sweeper for expired / orphaned / temp files.
**Rooms**: 45 s single-use room-scoped ticket as WebSocket subprotocol (never the login token), Origin check, socket
expiry tied to the login (`reauth`), strict decoding (unknown fields rejected), 16 KB frames, per-type rate limits,
role checks on every message, ephemeral TURN credentials (`/api/studio/ice`), relay-only switch, mic/cam only on a click,
red indicator for everyone, host lock / kick / mute / invite-only / friends-only, React escapes all user text, CSP extended only with `media-src blob:`.
**Content**: private by default, publish needs every contributor's yes (any can withdraw), copyright declaration required by the
upload endpoint, report button, 3 distinct reports quarantine an item, moderator takedown, metadata-only logs, retention limit.

## Running it
Install `ffmpeg` (with `ffprobe`) and ideally `clamav-daemon`. See the Studio block in `.env.example`.
Serve the frontend with `Permissions-Policy: microphone=(self), camera=(self)`.

## Known limits (read these)
* The backend Go files could not be compiled where they were written (no Go toolchain). Run `go vet ./... && go test ./...` first.
* Rooms, takes and reports live in memory (like game rooms). A restart ends every room; leftover files are swept as orphans.
* Host "mute" is enforced by the server (signalling is cut, recording refused) and by every client, but audio is peer-to-peer,
  so a modified client can't be forced silent. Use Remove for that.
* There is no global user-block feature in the codebase, so only room-level kick/ban and the existing friends relationship are honoured.
* Recording latency of the microphone is not compensated; takes can sit a few tens of ms late.
* Not browser-tested: please try two browsers on one machine first.


# Studio Phase 2A: the melody core

What changed, where, and how to check it.

## Server (backend-go)
- `studio_notes.go` (new): the note list, key and scale lock, instruments, sends, master filter, pattern length, and all validation.
- `studio_room.go`: new room fields, state snapshot fields, message dispatch, `clear` also clears notes, publish consent counts note authors.
- `studio_notes_test.go` (new): tests for every new message. Run `go test ./...` (not run here: no Go toolchain was available).
- Messages: `note_add` (one note or a whole chord/arpeggio, all-or-nothing), `note_move`, `note_resize`, `note_vel`, `note_del`, `note_clear` (host), `key`, `instr`, `bars` (host), `send`, `nmix`, `fx`.
- Limits: 256 notes per pattern, 32 per add, pitch 24..96, length and start inside the pattern, velocity 1..127, no two notes of the same pitch overlapping on a track, out-of-key notes refused while the lock is on. Producers only; same rate-limit buckets (plus one for chord adds).

## Frontend (frontend/src/studio)
- `theory.ts` (new): scales, key snapping, chord palette, inversions, strum/arpeggio, progression presets, bass-from-chords, delay times.
- `instruments.ts` (new): the seven instruments (synth fallback + sample-pack loader), the gliding 808.
- `audio.ts`: 11 channels, shared reverb + tempo-synced delay + master filter, note scheduling that follows the pattern length, `previewNote`.
- `PianoRoll.tsx`, `ChordTools.tsx`, `SpacePanel.tsx` (new); `Deck.tsx`, `Mixer.tsx`, `useStudio.ts`, `studioApi.ts`, `studio.css` updated.
- `frontend/public/studio-instruments/README.md` and `frontend/scripts/make-instrument-pack.py`: how to add sampled piano/guitar with a licence check.
- Checks: `npm run test:theory` (no dependencies; Node 22.6+).

## Not in this drop
Phase 2B (save/load/export, undo/redo, arrangement, vocals) is untouched, and no sample packs are installed yet, so every instrument currently plays from the built-in synth.
