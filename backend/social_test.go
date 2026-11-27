package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func addTestUsers(names ...string) {
	mu.Lock()
	defer mu.Unlock()
	for _, n := range names {
		users[n] = User{Username: n}
	}
}

func TestDMRoomIDIsSymmetric(t *testing.T) {
	if dmRoomID("ann", "bob") != dmRoomID("bob", "ann") {
		t.Fatal("room id must not depend on who opens the chat")
	}
	if dmRoomID("ann", "bob") == dmRoomID("ann", "cat") {
		t.Fatal("different pairs must get different rooms")
	}
	if !isDMRoom(dmRoomID("ann", "bob")) {
		t.Fatal("dm rooms must carry the reserved prefix")
	}
}

func TestToggleName(t *testing.T) {
	list, removed := toggleName(nil, "ann")
	if removed || len(list) != 1 {
		t.Fatalf("first toggle should add, got %v removed=%v", list, removed)
	}
	list, removed = toggleName(list, "ann")
	if !removed || len(list) != 0 {
		t.Fatalf("second toggle should remove, got %v removed=%v", list, removed)
	}
}

func TestFriendsAreMutualFollows(t *testing.T) {
	addTestUsers("sf_ann", "sf_bob")
	ctx := context.Background()
	ss := memorySocial
	_ = ss.Follow(ctx, "sf_ann", "sf_bob")
	if f, _ := ss.Friends(ctx, "sf_ann"); len(f) != 0 {
		t.Fatalf("a one-way follow is not a friendship: %v", f)
	}
	_ = ss.Follow(ctx, "sf_bob", "sf_ann")
	if f, _ := ss.Friends(ctx, "sf_ann"); len(f) != 1 || f[0] != "sf_bob" {
		t.Fatalf("mutual follow should make friends: %v", f)
	}
	_ = ss.Unfollow(ctx, "sf_bob", "sf_ann")
	if f, _ := ss.Friends(ctx, "sf_ann"); len(f) != 0 {
		t.Fatalf("unfollow should end the friendship: %v", f)
	}
	if err := ss.Follow(ctx, "sf_ann", "sf_ann"); err != ErrSelfFollow {
		t.Fatalf("self follow should be refused, got %v", err)
	}
}

func TestDMPolicy(t *testing.T) {
	addTestUsers("dm_ann", "dm_bob")
	ctx := context.Background()
	ok, _ := dmAllowed(ctx, "dm_ann", "dm_bob")
	if !ok {
		t.Fatal("default policy is everyone")
	}
	_ = memorySocial.SetPrivacy(ctx, "dm_bob", Privacy{DM: policyFriends, Find: policyEveryone})
	if ok, _ := dmAllowed(ctx, "dm_ann", "dm_bob"); ok {
		t.Fatal("friends-only must refuse a stranger")
	}
	_ = memorySocial.Follow(ctx, "dm_ann", "dm_bob")
	_ = memorySocial.Follow(ctx, "dm_bob", "dm_ann")
	if ok, _ := dmAllowed(ctx, "dm_ann", "dm_bob"); !ok {
		t.Fatal("friends-only must allow a friend")
	}
	_ = memorySocial.SetPrivacy(ctx, "dm_bob", Privacy{DM: policyNobody, Find: policyEveryone})
	if ok, _ := dmAllowed(ctx, "dm_ann", "dm_bob"); ok {
		t.Fatal("nobody must refuse everyone")
	}
}

func TestPresenceOnlyForFriendsAndHideWorks(t *testing.T) {
	addTestUsers("pr_ann", "pr_bob")
	ctx := context.Background()
	h := newPresenceHub()
	_ = memorySocial.Follow(ctx, "pr_ann", "pr_bob")
	_ = memorySocial.Follow(ctx, "pr_bob", "pr_ann")
	h.rooms["pr_bob"] = RoomRef{Code: "ABCDE", Map: "arena", Name: "Quick Arena", Public: true}

	views := h.FriendViews("pr_ann")
	if len(views) != 1 || !views[0].Online || views[0].Room == nil || views[0].Room.Code != "ABCDE" {
		t.Fatalf("a friend should see room and online state: %+v", views)
	}

	_ = memorySocial.SetPrivacy(ctx, "pr_bob", Privacy{HidePresence: true, DM: policyEveryone, Find: policyEveryone})
	h.Invalidate("pr_bob", "pr_ann")
	if v := h.View("pr_bob"); v.Online || v.Room != nil {
		t.Fatalf("hidden presence must look offline: %+v", v)
	}

	_ = memorySocial.SetPrivacy(ctx, "pr_bob", Privacy{DM: policyEveryone, Find: policyEveryone})
	h.Invalidate("pr_bob")
	h.rooms["pr_bob"] = RoomRef{Code: "SECRET", Map: "arena", Name: "Quick Arena", Public: false}
	if v := h.View("pr_bob"); v.Room == nil || v.Room.Code != "" || v.Room.Public {
		t.Fatalf("a private room's code must never be shown: %+v", v)
	}
}

func TestFollowersAndFollowingLists(t *testing.T) {
	addTestUsers("fl_ann", "fl_bob", "fl_cat")
	ctx := context.Background()
	ss := memorySocial
	_ = ss.Follow(ctx, "fl_bob", "fl_ann")
	_ = ss.Follow(ctx, "fl_cat", "fl_ann")
	_ = ss.Follow(ctx, "fl_ann", "fl_bob")

	if got, _ := ss.Followers(ctx, "fl_ann"); len(got) != 2 || got[0] != "fl_bob" || got[1] != "fl_cat" {
		t.Fatalf("followers should be sorted and complete: %v", got)
	}
	if got, _ := ss.Following(ctx, "fl_ann"); len(got) != 1 || got[0] != "fl_bob" {
		t.Fatalf("following should list who ann follows: %v", got)
	}
	if got, _ := ss.Following(ctx, "fl_nobody"); got == nil || len(got) != 0 {
		t.Fatalf("an empty list must be an empty slice, not nil: %v", got)
	}
}

func TestPeopleListsAreFriendsOnly(t *testing.T) {
	profileSetup(t)
	ctx := context.Background()
	_, ann := userWithPassword(t, "pl_ann", "correct horse battery")
	_, bob := userWithPassword(t, "pl_bob", "correct horse battery")
	_, cat := userWithPassword(t, "pl_cat", "correct horse battery")
	// ann and bob are friends; cat only follows ann.
	_ = memorySocial.Follow(ctx, "pl_ann", "pl_bob")
	_ = memorySocial.Follow(ctx, "pl_bob", "pl_ann")
	_ = memorySocial.Follow(ctx, "pl_cat", "pl_ann")

	get := func(tok, name, list string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/user/people?name="+name+"&list="+list, nil)
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		return do(PeopleHandler, r)
	}
	names := func(w *httptest.ResponseRecorder) []string {
		var out struct {
			Users []string `json:"users"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("bad json: %v", err)
		}
		return out.Users
	}

	if w := get("", "pl_ann", "followers"); w.Code != http.StatusUnauthorized {
		t.Fatalf("lists need a login, got %d", w.Code)
	}
	if w := get(ann, "pl_ann", "followers"); w.Code != http.StatusOK || len(names(w)) != 2 {
		t.Fatalf("you can see your own followers: %d %s", w.Code, w.Body.String())
	}
	if w := get(bob, "pl_ann", "followers"); w.Code != http.StatusOK || len(names(w)) != 2 {
		t.Fatalf("a friend can see the list: %d %s", w.Code, w.Body.String())
	}
	if w := get(bob, "pl_ann", "friends"); w.Code != http.StatusOK || len(names(w)) != 1 {
		t.Fatalf("a friend can see the friends list: %d %s", w.Code, w.Body.String())
	}
	if w := get(cat, "pl_ann", "followers"); w.Code != http.StatusForbidden {
		t.Fatalf("a one-way follower is not a friend, got %d", w.Code)
	}
	if w := get(cat, "pl_ghost", "following"); w.Code != http.StatusForbidden {
		t.Fatalf("an unknown player must look the same as a private list, got %d", w.Code)
	}
	if w := get(ann, "pl_ann", "everyone"); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown list kind should be refused, got %d", w.Code)
	}
	if w := get(ann, "bad!name", "followers"); w.Code != http.StatusBadRequest {
		t.Fatalf("bad names should be refused, got %d", w.Code)
	}
}
