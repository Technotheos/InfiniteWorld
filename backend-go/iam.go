package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

// ---------------------------------------------------------------------------
// IAM: roles, permissions and the checks that guard admin actions.
//
// Roles (lowest to highest): user < moderator < admin.
// Authorization is permission-based: handlers ask "can this role do X?", never
// "is this an admin?", so adding a role later is a one-line change.
//
// Hierarchy rules, enforced for every admin action:
//   - nobody may act on themselves (no self-promotion, no self-lockout);
//   - you may only act on accounts of a strictly lower rank;
//   - the admin role is granted and removed ONLY from the server console
//     (`go run . promote <user>`), never through the web API, so a stolen
//     admin session cannot mint more admins.
// ---------------------------------------------------------------------------

type Role string

const (
	RoleUser      Role = "user"
	RoleModerator Role = "moderator"
	RoleAdmin     Role = "admin"
)

type Permission string

const (
	PermUsersRead      Permission = "users.read"
	PermUsersDisable   Permission = "users.disable"
	PermSessionsRevoke Permission = "sessions.revoke"
	PermRoleSet        Permission = "users.role.set"
	PermAuditRead      Permission = "audit.read"
)

var rolePermissions = map[Role]map[Permission]bool{
	RoleUser: {},
	RoleModerator: {
		PermUsersRead: true, PermUsersDisable: true, PermSessionsRevoke: true,
	},
	RoleAdmin: {
		PermUsersRead: true, PermUsersDisable: true, PermSessionsRevoke: true,
		PermRoleSet: true, PermAuditRead: true,
	},
}

// norm treats an empty or unknown role as the least privileged one.
func (r Role) norm() Role {
	if _, ok := rolePermissions[r]; ok && r != "" {
		return r
	}
	return RoleUser
}

func (r Role) rank() int {
	switch r.norm() {
	case RoleAdmin:
		return 2
	case RoleModerator:
		return 1
	}
	return 0
}

func (r Role) Can(p Permission) bool { return rolePermissions[r.norm()][p] }

func (r Role) Permissions() []string {
	out := []string{}
	for _, p := range []Permission{PermUsersRead, PermUsersDisable, PermSessionsRevoke, PermRoleSet, PermAuditRead} {
		if r.Can(p) {
			out = append(out, string(p))
		}
	}
	return out
}

// assignableRoles are the roles the web API may set. "admin" is console-only.
func assignableRole(r Role) bool { return r == RoleUser || r == RoleModerator }

var (
	ErrForbiddenTarget = errors.New("you cannot perform this action on that account")
	ErrSelfAction      = errors.New("you cannot do this to your own account")
)

// canManage applies the hierarchy rules to an admin action.
func canManage(actor, target AuthInfo) error {
	if actor.ID == target.ID {
		return ErrSelfAction
	}
	if actor.Role.rank() <= target.Role.rank() {
		return ErrForbiddenTarget
	}
	return nil
}

// ---- request context -------------------------------------------------------

const authInfoCtxKey ctxKey = "authinfo"

// AuthFrom returns who the request is authenticated as (zero value if nobody).
func AuthFrom(r *http.Request) AuthInfo {
	a, _ := r.Context().Value(authInfoCtxKey).(AuthInfo)
	return a
}

// adminRoute is the single entry point for every /api/admin/* handler:
//  1. the caller's IP must be on ADMIN_ALLOWED_CIDRS (otherwise a plain 404,
//     so the routes are not even discoverable from elsewhere);
//  2. a valid, non-revoked access token;
//  3. the role must hold the required permission.
func adminRoute(method string, perm Permission, h http.HandlerFunc) http.HandlerFunc {
	authed := AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method && r.Method != http.MethodOptions {
			w.Header().Set("Allow", method)
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		info := AuthFrom(r)
		if !info.Role.Can(perm) {
			audit(r, AuditEvent{Actor: info.Username, Action: "admin.denied", Success: false,
				Detail: map[string]any{"permission": string(perm), "path": r.URL.Path}})
			writeError(w, http.StatusForbidden, "You do not have permission to do that")
			return
		}
		h(w, r)
	})
	return func(w http.ResponseWriter, r *http.Request) {
		if !adminIPAllowed(r) {
			setSecurityHeaders(w)
			audit(r, AuditEvent{Action: "admin.ip_denied", Success: false,
				Detail: map[string]any{"path": r.URL.Path}})
			writeError(w, http.StatusNotFound, "Not found")
			return
		}
		authed(w, r)
	}
}

// ---- console commands: go run . promote or demote ------------------------

// runCLI handles the account-role commands that must not be reachable over HTTP.
func runCLI(ctx context.Context, args []string) error {
	st := userStore()
	switch args[0] {
	case "promote":
		if len(args) != 2 {
			return errors.New("usage: promote <username>")
		}
		name := normalizeUsername(args[1])
		if err := st.SetRole(ctx, name, RoleAdmin); err != nil {
			return fmt.Errorf("promote %q: %w", name, err)
		}
		auditSystem(ctx, "admin.cli_promote", name, nil)
		fmt.Printf("%s is now an admin\n", name)
	case "demote":
		if len(args) != 2 {
			return errors.New("usage: demote <username>")
		}
		name := normalizeUsername(args[1])
		info, ok, err := st.AuthState(ctx, name)
		if err != nil || !ok {
			return fmt.Errorf("user %q not found", name)
		}
		if info.Role == RoleAdmin {
			n, err := st.CountAdmins(ctx)
			if err != nil {
				return err
			}
			if n <= 1 {
				return errors.New("refusing to demote the last active admin")
			}
		}
		if err := st.SetRole(ctx, name, RoleUser); err != nil {
			return err
		}
		auditSystem(ctx, "admin.cli_demote", name, nil)
		fmt.Printf("%s is now a regular user\n", name)
	default:
		return fmt.Errorf("unknown command %q (try: promote, demote)", args[0])
	}
	return nil
}
