package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

// ---------------------------------------------------------------------------
// Network policy: which browser origins may call the API, which IPs may reach
// admin routes, and how the real client IP is found behind a reverse proxy.
// ---------------------------------------------------------------------------

// ---- allowed origins -------------------------------------------------------

// parseAllowedOrigins validates ALLOWED_ORIGINS. It is strict on purpose: a
// typo must stop the server from starting, not quietly widen access.
//
// Accepted: scheme://host[:port] with nothing else. https is required except
// for localhost and private-network addresses (local development).
func parseAllowedOrigins(csv string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, raw := range strings.Split(csv, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		o, err := normalizeOrigin(raw)
		if err != nil {
			return nil, fmt.Errorf("ALLOWED_ORIGINS entry %q: %w", raw, err)
		}
		out[o] = true
	}
	return out, nil
}

func normalizeOrigin(raw string) (string, error) {
	if raw == "*" || strings.EqualFold(raw, "null") || strings.Contains(raw, "*") {
		return "", errors.New("wildcards and \"null\" are not allowed")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", errors.New("must look like https://app.example.com")
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("must be only scheme://host[:port], with no path, query or credentials")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("scheme must be http or https")
	}
	host := strings.ToLower(u.Hostname())
	if scheme == "http" && !isLocalOrPrivateHost(host) {
		return "", errors.New("plain http is only allowed for localhost and private-network addresses")
	}
	out := scheme + "://" + host
	if p := u.Port(); p != "" {
		out += ":" + p
	}
	if strings.Contains(host, ":") { // IPv6 literal
		out = scheme + "://[" + host + "]"
		if p := u.Port(); p != "" {
			out += ":" + p
		}
	}
	return out, nil
}

func isLocalOrPrivateHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// originAllowed decides whether a request's Origin header may be honoured.
//   - no Origin: not a browser cross-site request (CLI, server-to-server) -> allowed
//     here; cookie-based endpoints use originRequired instead.
//   - on the allowlist, or the same host the request was sent to -> allowed.
func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return originListed(r, origin)
}

// originRequired is the strict form for endpoints that authenticate with a
// cookie: browsers always send Origin on POST, so a missing one is rejected.
func originRequired(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin != "" && originListed(r, origin)
}

func originListed(r *http.Request, origin string) bool {
	if allowedOrigins[strings.ToLower(origin)] {
		return true
	}
	if u, err := url.Parse(origin); err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host) {
		return true // same-origin request (frontend and API served from one host)
	}
	return false
}

func isStateChanging(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return false
	}
	return true
}

// ---- CIDR lists and the real client IP --------------------------------------

func parseCIDRs(csv string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, raw := range strings.Split(csv, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if p, err := netip.ParsePrefix(raw); err == nil {
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(raw) // a bare IP means /32 or /128
		if err != nil {
			return nil, fmt.Errorf("%q is not an IP or CIDR range", raw)
		}
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
}

func inPrefixes(ip netip.Addr, list []netip.Prefix) bool {
	ip = ip.Unmap()
	for _, p := range list {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

var (
	trustedProxies []netip.Prefix // TRUSTED_PROXIES: who may set X-Forwarded-For
	adminAllowed   []netip.Prefix // ADMIN_ALLOWED_CIDRS: who may reach /api/admin/*
)

const defaultAdminCIDRs = "127.0.0.1/32,::1/128"

func initNetPolicy() error {
	var err error
	if trustedProxies, err = parseCIDRs(os.Getenv("TRUSTED_PROXIES")); err != nil {
		return fmt.Errorf("TRUSTED_PROXIES: %w", err)
	}
	csv := os.Getenv("ADMIN_ALLOWED_CIDRS")
	if strings.TrimSpace(csv) == "" {
		csv = defaultAdminCIDRs
	}
	if adminAllowed, err = parseCIDRs(csv); err != nil {
		return fmt.Errorf("ADMIN_ALLOWED_CIDRS: %w", err)
	}
	return nil
}

// clientIP returns the caller's address. X-Forwarded-For is only believed when
// the direct peer is a configured trusted proxy, and then only the entries to
// the left of the trusted hops are used, so a client cannot invent its own IP.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || len(trustedProxies) == 0 || !inPrefixes(peer, trustedProxies) {
		return host
	}
	var hops []string
	for _, v := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(v, ",")...)
	}
	for i := len(hops) - 1; i >= 0; i-- {
		ip, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return host // malformed chain: trust nothing
		}
		if !inPrefixes(ip, trustedProxies) {
			return ip.Unmap().String()
		}
	}
	return host
}

func adminIPAllowed(r *http.Request) bool {
	ip, err := netip.ParseAddr(clientIP(r))
	return err == nil && inPrefixes(ip, adminAllowed)
}
