package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Direct messages reuse the existing chat rooms (/ws?room_id=...).
//
// A DM is a chat room whose id is derived from the two usernames. Rooms named
// "dm-..." are reserved: canJoinRoom (ws.go) only lets the two participants in,
// and POST /api/dm/open is the only way to create one. Messages are relayed
// live, like every other chat room; nothing is stored.
// ---------------------------------------------------------------------------

const (
	dmPrefix       = "dm-"
	maxDMRooms     = 20000
	dmNotifyEvery  = 60 * time.Second
)

type dmRoom struct {
	a, b, opener string
	lastNotify   time.Time
}

var dmRooms = struct {
	sync.Mutex
	m map[string]*dmRoom
}{m: map[string]*dmRoom{}}

// dmRoomID is the same for (a,b) and (b,a).
func dmRoomID(a, b string) string {
	if a > b {
		a, b = b, a
	}
	sum := sha256.Sum256([]byte(a + "\x00" + b))
	return dmPrefix + hex.EncodeToString(sum[:])[:24]
}

// dmAllowed applies the recipient's "who can DM me" choice to `from`.
func dmAllowed(ctx context.Context, from, to string) (bool, error) {
	pr, err := socialStore().GetPrivacy(ctx, to)
	if err != nil {
		return false, err
	}
	switch pr.DM {
	case policyEveryone:
		return true, nil
	case policyFriends:
		iFollow, followsMe, err := socialStore().Relation(ctx, from, to)
		return iFollow && followsMe, err
	}
	return false, nil
}

// registerDM records the room and reports whether the other person should be
// told about it now (at most once a minute per room, so it cannot be used to spam).
func registerDM(opener, other string) (id string, notify bool) {
	id = dmRoomID(opener, other)
	dmRooms.Lock()
	defer dmRooms.Unlock()
	if len(dmRooms.m) >= maxDMRooms {
		n := 0
		for k := range dmRooms.m { // make room: drop a few arbitrary old entries
			delete(dmRooms.m, k)
			if n++; n >= 1000 {
				break
			}
		}
	}
	room := dmRooms.m[id]
	if room == nil {
		room = &dmRoom{a: opener, b: other, opener: opener}
		dmRooms.m[id] = room
	}
	if time.Since(room.lastNotify) >= dmNotifyEvery {
		room.lastNotify = time.Now()
		notify = true
	}
	return id, notify
}

// dmMayJoin is called from canJoinRoom for every "dm-..." room id.
func dmMayJoin(username, roomID string) bool {
	dmRooms.Lock()
	room := dmRooms.m[roomID]
	var a, b, opener string
	if room != nil {
		a, b, opener = room.a, room.b, room.opener
	}
	dmRooms.Unlock()
	if room == nil {
		return false // not created through /api/dm/open (or the server restarted)
	}
	var other string
	switch username {
	case a:
		other = b
	case b:
		other = a
	default:
		return false
	}
	if other == opener {
		return true // they started it: they already chose to talk to you
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	ok, err := dmAllowed(ctx, username, other)
	return err == nil && ok
}

func isDMRoom(id string) bool { return strings.HasPrefix(id, dmPrefix) }
