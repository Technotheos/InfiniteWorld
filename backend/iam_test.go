package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

// ---- helpers -----------------------------------------------------------------

// mkUser inserts a user with the given role and returns a valid access token.
func mkUser(t *testing.T, name string, role Role) (User, string) {
	t.Helper()
	u, tok := userWithPassword(t, name, "correct horse battery")
	mu.Lock()
	u.Role = role
	users[name] = u
	mu.Unlock()
	return u, tok
}

// adminEnv lets 192.0.2.0/24 (httptest's default client) reach /api/admin/*.
func adminEnv(t *testing.T) {
	t.Helper()
	profileSetup(t)
	old := adminAllowed
	adminAllowed = []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24")}
	t.Cleanup(func() { adminAllowed = old })
}

func bearer(r *http.Request, tok string) *http.Request {
	r.Header.Set("Authorization", "Bearer "+tok)
	return r
}

func adminPost(h http.HandlerFunc, path, tok string, f url.Values) *httptest.ResponseRecorder {
	return do(h, formReq(http.MethodPost, path, tok, f))
}

func lastAudit(t *testing.T, action string) AuditEvent {
	t.Helper()
	evs, _ := userStore().AuditList(context.Background(), AuditFilter{ActionPrefix: action, Limit: 1})
	if len(evs) == 0 {
		t.Fatalf("no audit event with action %q", action)
	}
	return evs[0]
}

// ---- roles & permissions ----------------------------------------------------------

func TestRolePermissions(t *testing.T) {
	cases := []struct {
		role Role
		perm Permission
		want bool
	}{
		{RoleUser, PermUsersRead, false},
		{"", PermUsersRead, false}, // empty role is the least privileged
		{"weird", PermAuditRead, false},
		{RoleModerator, PermUsersDisable, true},
		{RoleModerator, PermSessionsRevoke, true},
		{RoleModerator, PermRoleSet, false},
		{RoleModerator, PermAuditRead, false},
		{RoleAdmin, PermRoleSet, true},
		{RoleAdmin, PermAuditRead, true},
	}
	for _, c := range cases {
		if got := c.role.Can(c.perm); got != c.want {
			t.Errorf("%q.Can(%s) = %v, want %v", c.role, c.perm, got, c.want)
		}
	}
}

func TestCanManageHierarchy(t *testing.T) {
	admin := AuthInfo{ID: "a", Role: RoleAdmin}
	admin2 := AuthInfo{ID: "a2", Role: RoleAdmin}
	mod := AuthInfo{ID: "m", Role: RoleModerator}
	user := AuthInfo{ID: "u", Role: RoleUser}
	if canManage(admin, admin) == nil {
		t.Error("self-action must be refused")
	}
	if canManage(admin, admin2) == nil {
		t.Error("admins must not manage other admins through the API")
	}
	if canManage(mod, mod) == nil || canManage(mod, admin) == nil {
		t.Error("moderator must not manage peers or admins")
	}
	if canManage(admin, mod) != nil || canManage(admin, user) != nil || canManage(mod, user) != nil {
		t.Error("higher ranks must be able to manage lower ones")
	}
	if canManage(user, user) == nil {
		t.Error("a user cannot manage anyone")
	}
}

// ---- admin API ------------------------------------------------------------------

func TestAdminRoutesRequireAllowedIP(t *testing.T) {
	adminEnv(t)
	_, adminTok := mkUser(t, "ip_admin", RoleAdmin)

	r := bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users", nil), adminTok)
	if w := do(AdminUsersHandler, r); w.Code != http.StatusOK {
		t.Fatalf("allowed IP: got %d %s", w.Code, w.Body.String())
	}

	r = bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users", nil), adminTok)
	r.RemoteAddr = "203.0.113.9:4444" // outside the allowlist, even with a valid admin token
	if w := do(AdminUsersHandler, r); w.Code != http.StatusNotFound {
		t.Fatalf("blocked IP must look like a 404, got %d", w.Code)
	}
	if ev := lastAudit(t, "admin.ip_denied"); ev.Success {
		t.Error("denied attempt should be audited as a failure")
	}
}

func TestAdminPermissionChecks(t *testing.T) {
	adminEnv(t)
	mkUser(t, "pc_target", RoleUser)
	_, userTok := mkUser(t, "pc_user", RoleUser)
	_, modTok := mkUser(t, "pc_mod", RoleModerator)
	_, adminTok := mkUser(t, "pc_admin", RoleAdmin)

	// plain users get 403 everywhere
	r := bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users", nil), userTok)
	if w := do(AdminUsersHandler, r); w.Code != http.StatusForbidden {
		t.Fatalf("user listing users: got %d", w.Code)
	}
	// no token at all
	if w := do(AdminUsersHandler, httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: got %d", w.Code)
	}
	// moderator can read users but not the audit log nor set roles
	r = bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users?q=pc_", nil), modTok)
	if w := do(AdminUsersHandler, r); w.Code != http.StatusOK {
		t.Fatalf("moderator list: got %d", w.Code)
	}
	r = bearer(httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil), modTok)
	if w := do(AdminAuditHandler, r); w.Code != http.StatusForbidden {
		t.Fatalf("moderator audit: got %d", w.Code)
	}
	if w := adminPost(AdminRoleHandler, "/api/admin/users/role", modTok, url.Values{"username": {"pc_target"}, "role": {"moderator"}}); w.Code != http.StatusForbidden {
		t.Fatalf("moderator set role: got %d", w.Code)
	}
	// admin can
	r = bearer(httptest.NewRequest(http.MethodGet, "/api/admin/audit", nil), adminTok)
	if w := do(AdminAuditHandler, r); w.Code != http.StatusOK {
		t.Fatalf("admin audit: got %d", w.Code)
	}
}

func TestAdminSetRoleRules(t *testing.T) {
	adminEnv(t)
	mkUser(t, "rr_target", RoleUser)
	mkUser(t, "rr_other_admin", RoleAdmin)
	_, adminTok := mkUser(t, "rr_admin", RoleAdmin)
	set := func(name, role string) *httptest.ResponseRecorder {
		return adminPost(AdminRoleHandler, "/api/admin/users/role", adminTok, url.Values{"username": {name}, "role": {role}})
	}

	if w := set("rr_target", "moderator"); w.Code != http.StatusOK {
		t.Fatalf("promote to moderator: %d %s", w.Code, w.Body.String())
	}
	if info, _, _ := userStore().AuthState(context.Background(), "rr_target"); info.Role != RoleModerator {
		t.Fatalf("role not applied: %v", info.Role)
	}
	ev := lastAudit(t, "admin.role_set")
	if ev.Actor != "rr_admin" || ev.Target != "rr_target" || ev.Detail["to"] != "moderator" {
		t.Fatalf("bad audit event: %+v", ev)
	}
	if w := set("rr_target", "admin"); w.Code != http.StatusBadRequest {
		t.Fatalf("granting admin over HTTP must be refused, got %d", w.Code)
	}
	if w := set("rr_admin", "user"); w.Code != http.StatusForbidden {
		t.Fatalf("self-demotion must be refused, got %d", w.Code)
	}
	if w := set("rr_other_admin", "user"); w.Code != http.StatusForbidden {
		t.Fatalf("demoting another admin over HTTP must be refused, got %d", w.Code)
	}
	if w := set("no_such_user", "user"); w.Code != http.StatusNotFound {
		t.Fatalf("unknown user: got %d", w.Code)
	}
	if w := set("bad name!", "user"); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid username: got %d", w.Code)
	}
}

func TestDisableKillsTokensImmediately(t *testing.T) {
	adminEnv(t)
	_, victimTok := mkUser(t, "dk_victim", RoleUser)
	_, modTok := mkUser(t, "dk_mod", RoleModerator)

	me := func(tok string) int {
		return do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), tok)).Code
	}
	if me(victimTok) != http.StatusOK {
		t.Fatal("victim should start signed in")
	}
	w := adminPost(AdminDisableHandler, "/api/admin/users/disable", modTok, url.Values{"username": {"dk_victim"}, "reason": {"spam\x00 \u202eevil"}})
	if w.Code != http.StatusOK {
		t.Fatalf("disable: %d %s", w.Code, w.Body.String())
	}
	if me(victimTok) != http.StatusUnauthorized {
		t.Fatal("a disabled account's existing token must stop working at once")
	}
	if ev := lastAudit(t, "admin.user_disable"); strings.ContainsAny(ev.Detail["reason"].(string), "\x00\u202e") {
		t.Fatalf("reason was not sanitised: %q", ev.Detail["reason"])
	}
	// cannot log in while disabled, even with the right password
	lw := do(LoginHandler, formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"dk_victim"}, "password": {"correct horse battery"}}))
	if lw.Code != http.StatusForbidden {
		t.Fatalf("disabled login: got %d", lw.Code)
	}
	// re-enable: a NEW login works (the old token stays dead)
	if w := adminPost(AdminEnableHandler, "/api/admin/users/enable", modTok, url.Values{"username": {"dk_victim"}}); w.Code != http.StatusOK {
		t.Fatalf("enable: %d", w.Code)
	}
	if me(victimTok) != http.StatusUnauthorized {
		t.Fatal("old token must stay revoked after re-enabling")
	}
	lw = do(LoginHandler, formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"dk_victim"}, "password": {"correct horse battery"}}))
	if lw.Code != http.StatusOK {
		t.Fatalf("login after enable: got %d", lw.Code)
	}
}

func TestModeratorCannotTouchAdmins(t *testing.T) {
	adminEnv(t)
	mkUser(t, "mt_admin", RoleAdmin)
	_, modTok := mkUser(t, "mt_mod", RoleModerator)
	w := adminPost(AdminDisableHandler, "/api/admin/users/disable", modTok, url.Values{"username": {"mt_admin"}})
	if w.Code != http.StatusForbidden {
		t.Fatalf("got %d", w.Code)
	}
	if info, _, _ := userStore().AuthState(context.Background(), "mt_admin"); info.Disabled {
		t.Fatal("admin was disabled by a moderator")
	}
}

func TestAdminListUsersPagingAndSearch(t *testing.T) {
	adminEnv(t)
	for _, n := range []string{"pg_aaa", "pg_bbb", "pg_ccc"} {
		mkUser(t, n, RoleUser)
	}
	_, tok := mkUser(t, "pg_admin", RoleAdmin)
	get := func(q string) (users []AdminUser, next string) {
		w := do(AdminUsersHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users?"+q, nil), tok))
		var out struct {
			Users []AdminUser `json:"users"`
			Next  string      `json:"next"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != 200 {
			t.Fatalf("bad response %d: %s", w.Code, w.Body.String())
		}
		return out.Users, out.Next
	}
	page1, next := get("q=pg_&limit=2")
	if len(page1) != 2 || next == "" {
		t.Fatalf("page 1: %d users, next=%q", len(page1), next)
	}
	page2, _ := get("q=pg_&limit=2&after=" + next)
	if len(page2) == 0 || page2[0].Username <= next {
		t.Fatalf("page 2 did not continue after %q: %+v", next, page2)
	}
	if w := do(AdminUsersHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/admin/users?q=%27%3BDROP", nil), tok)); w.Code != http.StatusBadRequest {
		t.Fatalf("hostile search term must be rejected, got %d", w.Code)
	}
}

func TestMeReportsRoleAndPermissions(t *testing.T) {
	profileSetup(t)
	_, tok := mkUser(t, "me_mod", RoleModerator)
	w := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), tok))
	var me struct {
		Role        string   `json:"role"`
		Permissions []string `json:"permissions"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &me)
	if me.Role != "moderator" || len(me.Permissions) != 3 {
		t.Fatalf("unexpected: %+v", me)
	}
}

func TestCLIPromoteAndLastAdminGuard(t *testing.T) {
	profileSetup(t)
	// start from a state with no other admins
	mu.Lock()
	for n, u := range users {
		if u.Role == RoleAdmin {
			u.Role = RoleUser
			users[n] = u
		}
	}
	mu.Unlock()
	mkUser(t, "cli_one", RoleUser)
	mkUser(t, "cli_two", RoleUser)
	ctx := t.Context()

	if err := runCLI(ctx, []string{"promote", "CLI_One"}); err != nil {
		t.Fatal(err)
	}
	if err := runCLI(ctx, []string{"demote", "cli_one"}); err == nil {
		t.Fatal("demoting the last admin must be refused")
	}
	if err := runCLI(ctx, []string{"promote", "cli_two"}); err != nil {
		t.Fatal(err)
	}
	if err := runCLI(ctx, []string{"demote", "cli_one"}); err != nil {
		t.Fatalf("demote with another admin present: %v", err)
	}
	if err := runCLI(ctx, []string{"promote", "ghost_user"}); err == nil {
		t.Fatal("promoting a missing user must fail")
	}
	if ev := lastAudit(t, "admin.cli_"); ev.Actor != "console" {
		t.Fatalf("console actions should be audited: %+v", ev)
	}
}
