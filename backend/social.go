package main

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Social API (all routes need a login)
//
//	GET  /api/user?name=NAME        profile card + your relation to them
//	POST /api/follow                username=NAME
//	POST /api/unfollow              username=NAME
//	GET  /api/user/people           name=NAME&list=followers|following|friends (friends only)
//	GET  /api/me/friends            your friends and (honouring privacy) their presence
//	GET  /api/me/privacy            hide_presence, dm, find
//	POST /api/me/privacy            hide_presence=0|1&dm=everyone|friends|nobody&find=...
//	GET  /api/users/search?q=PRE    find people by name prefix (honours "who can find me")
//	POST /api/dm/open               username=NAME  -> {room_id}
// ---------------------------------------------------------------------------

var (
	UserCardHandler      = AuthMiddleware(userCardHandler)
	FollowHandler        = AuthMiddleware(followHandler(true))
	UnfollowHandler      = AuthMiddleware(followHandler(false))
	PeopleHandler        = AuthMiddleware(peopleHandler)
	FriendsHandler       = AuthMiddleware(friendsHandler)
	PrivacyHandler       = AuthMiddleware(privacyHandler)
	UserSearchHandler    = AuthMiddleware(userSearchHandler)
	DMOpenHandler        = AuthMiddleware(dmOpenHandler)
	searchQueryRe        = regexp.MustCompile(`^[a-z0-9_.-]+$`)
	socialNameRe         = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)
	socialActionLimiter  = newRateLimiter(60, time.Minute) // follow/unfollow/dm per user
	socialSearchLimiter  = newRateLimiter(40, time.Minute)
)

// cleanName lower-cases (usernames are stored lower-case) and validates.
func cleanName(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	return s, socialNameRe.MatchString(s)
}

func socialFail(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, ErrUserNotFound):
		writeError(w, http.StatusNotFound, "Player not found")
	case errors.Is(err, ErrSelfFollow):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		log.Printf("%s: %v", what, err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
	}
}

// ---- GET /api/user ------------------------------------------------------------

func userCardHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	me := UsernameFrom(r)
	name, ok := cleanName(r.URL.Query().Get("name"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid username")
		return
	}
	ss := socialStore()
	card, err := ss.Card(r.Context(), name)
	if err != nil {
		socialFail(w, "card", err)
		return
	}
	out := map[string]any{
		"username":       card.Username,
		"bio":            card.Bio,
		"created_at":     card.CreatedAt,
		"avatar_version": int64(0),
		"xp":             card.XP,
		"streak":         card.Streak,
		"badges":         card.Badges,
		"followers":      card.Followers,
		"following":      card.Following,
		"friends":        card.Friends,
		"you":            name == me,
	}
	if !card.AvatarUpdated.IsZero() {
		out["avatar_version"] = card.AvatarUpdated.UnixMilli()
	}
	if name != me {
		iFollow, followsMe, err := ss.Relation(r.Context(), me, name)
		if err != nil {
			socialFail(w, "relation", err)
			return
		}
		isFriend := iFollow && followsMe
		canDM, err := dmAllowed(r.Context(), me, name)
		if err != nil {
			socialFail(w, "dm policy", err)
			return
		}
		out["i_follow"], out["follows_me"], out["is_friend"], out["can_dm"] = iFollow, followsMe, isFriend, canDM
		if isFriend { // presence is for friends only
			out["presence"] = presenceHub.View(name)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- follow / unfollow ----------------------------------------------------------

func followHandler(follow bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		me := UsernameFrom(r)
		if !socialActionLimiter.allow(me) {
			writeError(w, http.StatusTooManyRequests, "Slow down a little")
			return
		}
		name, ok := cleanName(r.PostFormValue("username"))
		if !ok {
			writeError(w, http.StatusBadRequest, "Invalid username")
			return
		}
		ss := socialStore()
		var err error
		if follow {
			err = ss.Follow(r.Context(), me, name)
		} else {
			err = ss.Unfollow(r.Context(), me, name)
		}
		if err != nil {
			socialFail(w, "follow", err)
			return
		}
		presenceHub.FriendsChanged(me, name)
		iFollow, followsMe, err := ss.Relation(r.Context(), me, name)
		if err != nil {
			socialFail(w, "relation", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{
			"i_follow": iFollow, "follows_me": followsMe, "is_friend": iFollow && followsMe,
		})
	}
}

// ---- followers / following / friends lists ------------------------------------------

// peopleHandler serves the lists behind the numbers on a profile. The numbers are
// public; the names are for friends only: you can open your own lists and those
// of people who follow you back.
func peopleHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	me := UsernameFrom(r)
	if !socialSearchLimiter.allow(me) {
		writeError(w, http.StatusTooManyRequests, "Slow down a little")
		return
	}
	name, ok := cleanName(r.URL.Query().Get("name"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid username")
		return
	}
	kind := r.URL.Query().Get("list")
	if kind != "followers" && kind != "following" && kind != "friends" {
		writeError(w, http.StatusBadRequest, "Unknown list")
		return
	}
	ss := socialStore()
	if name != me {
		iFollow, followsMe, err := ss.Relation(r.Context(), me, name)
		if err != nil {
			socialFail(w, "relation", err)
			return
		}
		if !iFollow || !followsMe {
			writeError(w, http.StatusForbidden, "Only friends can see this list")
			return
		}
	}
	var (
		names []string
		err   error
	)
	switch kind {
	case "followers":
		names, err = ss.Followers(r.Context(), name)
	case "following":
		names, err = ss.Following(r.Context(), name)
	default:
		names, err = ss.Friends(r.Context(), name)
	}
	if err != nil {
		socialFail(w, "people", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": names})
}

// ---- friends ------------------------------------------------------------------------

func friendsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	presenceHub.Invalidate(UsernameFrom(r)) // a fresh list whenever the client asks
	writeJSON(w, http.StatusOK, map[string]any{"friends": presenceHub.FriendViews(UsernameFrom(r))})
}

// ---- privacy ------------------------------------------------------------------------

func privacyHandler(w http.ResponseWriter, r *http.Request) {
	me := UsernameFrom(r)
	ss := socialStore()
	switch r.Method {
	case http.MethodGet:
		p, err := ss.GetPrivacy(r.Context(), me)
		if err != nil {
			socialFail(w, "privacy", err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	case http.MethodPost:
		p, err := ss.GetPrivacy(r.Context(), me)
		if err != nil {
			socialFail(w, "privacy", err)
			return
		}
		// Only fields that are present change, so each toggle can save on its own.
		if v := r.PostFormValue("hide_presence"); v != "" {
			p.HidePresence = v == "1" || v == "true"
		}
		if v := r.PostFormValue("dm"); v != "" {
			if !validPolicy(v) {
				writeError(w, http.StatusBadRequest, "Invalid choice for who can message you")
				return
			}
			p.DM = v
		}
		if v := r.PostFormValue("find"); v != "" {
			if !validPolicy(v) {
				writeError(w, http.StatusBadRequest, "Invalid choice for who can find you")
				return
			}
			p.Find = v
		}
		if err := ss.SetPrivacy(r.Context(), me, p); err != nil {
			socialFail(w, "set privacy", err)
			return
		}
		presenceHub.PrivacyChanged(me)
		writeJSON(w, http.StatusOK, p)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// ---- search -------------------------------------------------------------------------

func userSearchHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	me := UsernameFrom(r)
	if !socialSearchLimiter.allow(me) {
		writeError(w, http.StatusTooManyRequests, "Slow down a little")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if len(q) < 2 || len(q) > 32 || !searchQueryRe.MatchString(q) {
		writeJSON(w, http.StatusOK, map[string]any{"users": []string{}})
		return
	}
	names, err := socialStore().Search(r.Context(), me, q, 10)
	if err != nil {
		socialFail(w, "search", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": names})
}

// ---- direct messages ----------------------------------------------------------------

func dmOpenHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	me := UsernameFrom(r)
	if !socialActionLimiter.allow(me) {
		writeError(w, http.StatusTooManyRequests, "Slow down a little")
		return
	}
	name, ok := cleanName(r.PostFormValue("username"))
	if !ok || name == me {
		writeError(w, http.StatusBadRequest, "Invalid username")
		return
	}
	allowed, err := dmAllowed(r.Context(), me, name)
	if err != nil {
		socialFail(w, "dm", err)
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "This player is not accepting messages from you")
		return
	}
	id, notify := registerDM(me, name)
	if notify {
		presenceHub.SendTo(name, "dm", map[string]string{"from": me, "room_id": id})
	}
	writeJSON(w, http.StatusOK, map[string]string{"room_id": id, "with": name})
}
