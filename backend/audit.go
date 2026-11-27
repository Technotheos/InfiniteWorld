package main

import (
	"context"
	"log"
	"net/http"
	"time"
)

// ---------------------------------------------------------------------------
// Audit trail: who did what, from where, and whether it worked.
//
// Events are written synchronously with a short timeout; a failure is logged
// but never blocks or fails the request. Never put secrets (passwords, tokens)
// in Detail. The table is append-only at the database level (see migration 3).
// ---------------------------------------------------------------------------

type AuditEvent struct {
	ID        int64          `json:"id"`
	At        time.Time      `json:"at"`
	Actor     string         `json:"actor"`
	Action    string         `json:"action"`
	Target    string         `json:"target,omitempty"`
	Success   bool           `json:"success"`
	IP        string         `json:"ip,omitempty"`
	UserAgent string         `json:"user_agent,omitempty"`
	Detail    map[string]any `json:"detail,omitempty"`
}

type AuditFilter struct {
	Before       int64  // return events with id < Before (0 = newest)
	ActionPrefix string // e.g. "auth." or "admin."
	User         string // matches actor or target
	Limit        int
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// audit records an event for the current request. Success defaults to true
// only when the caller says so via the field; set it explicitly for failures.
func audit(r *http.Request, e AuditEvent) {
	if e.Actor == "" {
		e.Actor = UsernameFrom(r)
	}
	e.IP = clip(clientIP(r), 64)
	e.UserAgent = clip(r.UserAgent(), 300)
	writeAudit(r.Context(), e)
}

// auditOK is audit with Success = true.
func auditOK(r *http.Request, action, target string, detail map[string]any) {
	audit(r, AuditEvent{Action: action, Target: target, Success: true, Detail: detail})
}

// auditSystem records an event that did not come from an HTTP request.
func auditSystem(ctx context.Context, action, target string, detail map[string]any) {
	writeAudit(ctx, AuditEvent{Actor: "console", Action: action, Target: target, Success: true, Detail: detail})
}

func writeAudit(ctx context.Context, e AuditEvent) {
	e.At = time.Now()
	// Detached from the request so a cancelled request still leaves a record.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), dbTimeout)
	defer cancel()
	if err := userStore().AuditWrite(wctx, e); err != nil {
		log.Printf("audit write failed (%s): %v", e.Action, err)
	}
}
