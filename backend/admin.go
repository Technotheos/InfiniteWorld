package main

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
)

// ---------------------------------------------------------------------------
// Admin API. Every route goes through adminRoute (IP allowlist -> valid token
// -> permission). State changes are POST with form fields, like the rest of
// the API, and every one is written to the audit log.
//
//	GET  /api/admin/users?q=&after=&limit=     users.read
//	POST /api/admin/users/role      username, role (user|moderator)   users.role.set
//	POST /api/admin/users/disable   username, reason                  users.disable
//	POST /api/admin/users/enable    username                          users.disable
//	POST /api/admin/users/revoke    username                          sessions.revoke
//	GET  /api/admin/audit?before=&action=&user=&limit=                audit.read
// ---------------------------------------------------------------------------

var (
	AdminUsersHandler   = adminRoute(http.MethodGet, PermUsersRead, adminListUsers)
	AdminRoleHandler    = adminRoute(http.MethodPost, PermRoleSet, adminSetRole)
	AdminDisableHandler = adminRoute(http.MethodPost, PermUsersDisable, adminDisable)
	AdminEnableHandler  = adminRoute(http.MethodPost, PermUsersDisable, adminEnable)
	AdminRevokeHandler  = adminRoute(http.MethodPost, PermSessionsRevoke, adminRevokeSessions)
	AdminAuditHandler   = adminRoute(http.MethodGet, PermAuditRead, adminAuditLog)
)

var (
	searchRe = regexp.MustCompile(`^[a-z0-9_.-]{0,32}$`)
	actionRe = regexp.MustCompile(`^[a-z_.]{0,32}$`)
)

func queryInt(r *http.Request, key string, def, min, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || n < min {
		return def
	}
	if n > max {
		return max
	}
	return n
}

func adminListUsers(w http.ResponseWriter, r *http.Request) {
	q := normalizeUsername(r.URL.Query().Get("q"))
	after := normalizeUsername(r.URL.Query().Get("after"))
	if !searchRe.MatchString(q) || !searchRe.MatchString(after) {
		writeError(w, http.StatusBadRequest, "Invalid search")
		return
	}
	limit := queryInt(r, "limit", 25, 1, 100)
	list, err := userStore().ListUsers(r.Context(), q, after, limit+1)
	if err != nil {
		storeUnavailable(w, "admin list users", err)
		return
	}
	next := ""
	if len(list) > limit {
		list = list[:limit]
		next = list[len(list)-1].Username
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"users": list, "next": next})
}

// target loads the account an action is aimed at and applies the hierarchy rules.
func adminTarget(w http.ResponseWriter, r *http.Request) (actor, target AuthInfo, ok bool) {
	actor = AuthFrom(r)
	name := normalizeUsername(r.PostFormValue("username"))
	if !usernameRe.MatchString(name) {
		writeError(w, http.StatusBadRequest, "Invalid username")
		return
	}
	target, found, err := userStore().AuthState(r.Context(), name)
	if err != nil {
		storeUnavailable(w, "admin target", err)
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}
	if err := canManage(actor, target); err != nil {
		status := http.StatusForbidden
		audit(r, AuditEvent{Actor: actor.Username, Action: "admin.denied", Target: name, Success: false,
			Detail: map[string]any{"reason": err.Error(), "path": r.URL.Path}})
		writeError(w, status, err.Error())
		return
	}
	return actor, target, true
}

func adminSetRole(w http.ResponseWriter, r *http.Request) {
	_, target, ok := adminTarget(w, r)
	if !ok {
		return
	}
	role := Role(r.PostFormValue("role"))
	if !assignableRole(role) {
		writeError(w, http.StatusBadRequest, "Role must be \"user\" or \"moderator\" (admins are made from the server console)")
		return
	}
	if err := userStore().SetRole(r.Context(), target.Username, role); err != nil {
		storeUnavailable(w, "set role", err)
		return
	}
	auditOK(r, "admin.role_set", target.Username, map[string]any{"from": string(target.Role), "to": string(role)})
	writeJSON(w, http.StatusOK, map[string]string{"username": target.Username, "role": string(role)})
}

func adminDisable(w http.ResponseWriter, r *http.Request) {
	_, target, ok := adminTarget(w, r)
	if !ok {
		return
	}
	reason := stripText(r.PostFormValue("reason"), 200, false)
	if err := userStore().SetDisabled(r.Context(), target.Username, true, reason); err != nil {
		storeUnavailable(w, "disable user", err)
		return
	}
	auditOK(r, "admin.user_disable", target.Username, map[string]any{"reason": reason})
	writeJSON(w, http.StatusOK, map[string]interface{}{"username": target.Username, "disabled": true})
}

func adminEnable(w http.ResponseWriter, r *http.Request) {
	_, target, ok := adminTarget(w, r)
	if !ok {
		return
	}
	if err := userStore().SetDisabled(r.Context(), target.Username, false, ""); err != nil {
		storeUnavailable(w, "enable user", err)
		return
	}
	auditOK(r, "admin.user_enable", target.Username, nil)
	writeJSON(w, http.StatusOK, map[string]interface{}{"username": target.Username, "disabled": false})
}

func adminRevokeSessions(w http.ResponseWriter, r *http.Request) {
	_, target, ok := adminTarget(w, r)
	if !ok {
		return
	}
	if err := userStore().RevokeAllSessions(r.Context(), target.Username); err != nil {
		if errors.Is(err, ErrUserNotFound) {
			writeError(w, http.StatusNotFound, "User not found")
			return
		}
		storeUnavailable(w, "admin revoke sessions", err)
		return
	}
	auditOK(r, "admin.sessions_revoked", target.Username, nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func adminAuditLog(w http.ResponseWriter, r *http.Request) {
	f := AuditFilter{
		Before:       int64(queryInt(r, "before", 0, 0, 1<<31-1)),
		ActionPrefix: r.URL.Query().Get("action"),
		User:         normalizeUsername(r.URL.Query().Get("user")),
		Limit:        queryInt(r, "limit", 50, 1, 200),
	}
	if !actionRe.MatchString(f.ActionPrefix) || !searchRe.MatchString(f.User) {
		writeError(w, http.StatusBadRequest, "Invalid filter")
		return
	}
	events, err := userStore().AuditList(r.Context(), f)
	if err != nil {
		storeUnavailable(w, "audit list", err)
		return
	}
	next := int64(0)
	if len(events) == f.Limit {
		next = events[len(events)-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"events": events, "next": next})
}
