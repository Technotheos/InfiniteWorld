package main

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestParseAllowedOrigins(t *testing.T) {
	good := []string{
		"https://app.example.com", "http://localhost:5173", "http://127.0.0.1:5173",
		"http://192.168.1.20:5173", "HTTPS://App.Example.com:8443", "https://a.example.com, https://b.example.com", "",
	}
	for _, g := range good {
		if _, err := parseAllowedOrigins(g); err != nil {
			t.Errorf("%q should be accepted: %v", g, err)
		}
	}
	bad := []string{
		"*", "null", "https://*.example.com", "https://app.example.com/path", "https://app.example.com?x=1",
		"https://user:pw@app.example.com", "ftp://app.example.com", "app.example.com", "http://app.example.com",
		"http://203.0.113.5:5173", "javascript:alert(1)",
	}
	for _, b := range bad {
		if _, err := parseAllowedOrigins(b); err == nil {
			t.Errorf("%q must be rejected", b)
		}
	}
	m, _ := parseAllowedOrigins("HTTPS://App.Example.com:8443")
	if !m["https://app.example.com:8443"] {
		t.Errorf("origins must be normalised: %v", m)
	}
}

func TestOriginDecisions(t *testing.T) {
	old := allowedOrigins
	allowedOrigins = map[string]bool{"https://app.example.com": true}
	defer func() { allowedOrigins = old }()

	mk := func(host, origin string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "http://"+host+"/x", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	if !originAllowed(mk("api.example.com", "")) {
		t.Error("no Origin header (non-browser) should be allowed for token-authenticated calls")
	}
	if originRequired(mk("api.example.com", "")) {
		t.Error("cookie endpoints must require an Origin")
	}
	if !originAllowed(mk("api.example.com", "https://app.example.com")) {
		t.Error("listed origin should pass")
	}
	if originAllowed(mk("api.example.com", "https://evil.example")) {
		t.Error("unlisted origin must fail")
	}
	if !originAllowed(mk("site.example.com", "https://site.example.com")) {
		t.Error("same-host origin (app and API on one domain) should pass")
	}
	if originAllowed(mk("site.example.com", "https://site.example.com.evil.io")) {
		t.Error("suffix tricks must not pass")
	}
}

func TestClientIPOnlyTrustsConfiguredProxies(t *testing.T) {
	old := trustedProxies
	defer func() { trustedProxies = old }()

	req := func(remote, xff string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return r
	}

	trustedProxies = nil
	if got := clientIP(req("203.0.113.5:1234", "1.2.3.4")); got != "203.0.113.5" {
		t.Errorf("no trusted proxies: XFF must be ignored, got %s", got)
	}

	trustedProxies, _ = parseCIDRs("10.0.0.0/8")
	if got := clientIP(req("203.0.113.5:1234", "1.2.3.4")); got != "203.0.113.5" {
		t.Errorf("untrusted peer cannot set XFF, got %s", got)
	}
	if got := clientIP(req("10.0.0.2:80", "198.51.100.9")); got != "198.51.100.9" {
		t.Errorf("trusted proxy: want client IP, got %s", got)
	}
	// a client who prepends a fake address cannot spoof: the rightmost untrusted hop wins
	if got := clientIP(req("10.0.0.2:80", "6.6.6.6, 198.51.100.9, 10.0.0.7")); got != "198.51.100.9" {
		t.Errorf("spoofed prefix: got %s", got)
	}
	if got := clientIP(req("10.0.0.2:80", "not-an-ip")); got != "10.0.0.2" {
		t.Errorf("malformed chain: got %s", got)
	}
}

func TestParseCIDRs(t *testing.T) {
	list, err := parseCIDRs("127.0.0.1, 10.0.0.0/8 ,::1")
	if err != nil || len(list) != 3 {
		t.Fatalf("%v %v", list, err)
	}
	if !inPrefixes(netip.MustParseAddr("::ffff:10.1.2.3"), list) {
		t.Error("IPv4-mapped IPv6 must match its IPv4 range")
	}
	if _, err := parseCIDRs("10.0.0.0/33"); err == nil {
		t.Error("bad CIDR must error")
	}
	if _, err := parseCIDRs("everyone"); err == nil {
		t.Error("garbage must error")
	}
}
