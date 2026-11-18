package main

import (
	"context"
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
