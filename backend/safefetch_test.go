package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
		"169.254.169.254", // cloud metadata
		"100.64.0.1",      // CGNAT
		"0.0.0.0", "0.1.2.3", "224.0.0.1", "255.255.255.255", "240.0.0.1",
		"192.0.2.10", "198.18.0.1", "203.0.113.4",
		"::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1",
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", // IPv4-mapped bypass attempts
		"64:ff9b::7f00:1", "2002:7f00:1::1", // NAT64 / 6to4 wrappers around internal IPv4
	}
	for _, s := range blocked {
		if !isBlockedIP(netip.MustParseAddr(s)) {
			t.Errorf("%s must be blocked", s)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, s := range allowed {
		if isBlockedIP(netip.MustParseAddr(s)) {
			t.Errorf("%s is public and must be allowed", s)
		}
	}
}

func TestValidateURLRules(t *testing.T) {
	f := NewSafeFetcher(SafeFetchConfig{AllowedHosts: []string{"api.example.com", "*.cdn.example.com"}})
	ok := []string{"https://api.example.com/x", "https://API.example.com/x?y=1", "https://img.cdn.example.com/a.png", "https://api.example.com:443/x"}
	for _, s := range ok {
		u, _ := url.Parse(s)
		if err := f.validate(u); err != nil {
			t.Errorf("%s should be allowed: %v", s, err)
		}
	}
	bad := map[string]string{
		"http://api.example.com/x":          "plain http",
		"https://evil.example/x":            "host not on allowlist",
		"https://api.example.com.evil.io/x": "suffix trick",
		"https://evilapi.example.com/x":     "prefix trick",
		"https://cdn.example.com/x":         "wildcard must not match the bare domain",
		"https://api.example.com:8443/x":    "non-443 port",
		"https://user:pw@api.example.com/x": "credentials in URL",
		"https://127.0.0.1/x":               "IP literal",
		"https://[::1]/x":                   "IPv6 literal",
		"https://169.254.169.254/latest":    "metadata IP",
		"https://2130706433/x":              "decimal-encoded 127.0.0.1",
		"https://0x7f.0.0.1/x":              "hex-encoded loopback",
		"https://ａpi.example.com/x":         "full-width look-alike",
		"file:///etc/passwd":                "file scheme",
		"gopher://api.example.com/x":        "gopher scheme",
		"ftp://api.example.com/x":           "ftp scheme",
		"https:///nohost":                   "missing host",
	}
	for s, why := range bad {
		u, err := url.Parse(s)
		if err != nil {
			continue // unparsable is fine
		}
		if err := f.validate(u); err == nil {
			t.Errorf("%s must be blocked (%s)", s, why)
		}
	}
}

func TestEmptyAllowlistDeniesEverything(t *testing.T) {
	f := NewSafeFetcher(SafeFetchConfig{})
	if _, err := f.Get(context.Background(), "https://example.com/"); !errors.Is(err, ErrFetchBlocked) {
		t.Fatalf("deny-by-default failed: %v", err)
	}
}

// DNS-rebinding style defence: the hostname is allowlisted and well-formed,
// but it RESOLVES to a loopback address. The dial-time guard must stop it.
func TestDialTimeGuardBlocksAllowlistedHostResolvingToLoopback(t *testing.T) {
	f := NewSafeFetcher(SafeFetchConfig{AllowedHosts: []string{"localhost"}, Timeout: 3 * time.Second})
	_, err := f.Get(context.Background(), "https://localhost/")
	if !errors.Is(err, ErrFetchBlocked) {
		t.Fatalf("expected the connection to be blocked at dial time, got: %v", err)
	}
}

func TestFetchAgainstLocalServer(t *testing.T) {
	big := strings.Repeat("x", 5000)
	mux := http.NewServeMux()
	mux.HandleFunc("/ok", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello"))
	})
	mux.HandleFunc("/big", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(big)) })
	mux.HandleFunc("/bigstream", func(w http.ResponseWriter, r *http.Request) {
		fl := w.(http.Flusher)
		for i := 0; i < 10; i++ { // no Content-Length: size only known by reading
			_, _ = w.Write([]byte(big[:1000]))
			fl.Flush()
		}
	})
	mux.HandleFunc("/redir-evil", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://localhost:1/steal", http.StatusFound) // host not on allowlist
	})
	mux.HandleFunc("/loop", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/loop", http.StatusFound) })
	mux.HandleFunc("/redir-ok", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/ok", http.StatusFound) })
	srv := httptest.NewServer(mux)
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	hostOnly := strings.Split(host, ":")[0]

	f := NewSafeFetcher(SafeFetchConfig{AllowedHosts: []string{hostOnly}, MaxBytes: 2048, testing: true})

	res, err := f.Get(context.Background(), srv.URL+"/ok")
	if err != nil || string(res.Body) != "hello" || res.Status != 200 {
		t.Fatalf("plain fetch: %+v %v", res, err)
	}
	if _, err := f.Get(context.Background(), srv.URL+"/big"); !errors.Is(err, ErrFetchTooLarge) {
		t.Fatalf("Content-Length over the cap: %v", err)
	}
	if _, err := f.Get(context.Background(), srv.URL+"/bigstream"); !errors.Is(err, ErrFetchTooLarge) {
		t.Fatalf("streamed body over the cap: %v", err)
	}
	if _, err := f.Get(context.Background(), srv.URL+"/redir-evil"); !errors.Is(err, ErrFetchBlocked) {
		t.Fatalf("redirect to a host off the allowlist must be blocked: %v", err)
	}
	if _, err := f.Get(context.Background(), srv.URL+"/loop"); err == nil {
		t.Fatal("redirect loops must stop")
	}
	if res, err := f.Get(context.Background(), srv.URL+"/redir-ok"); err != nil || string(res.Body) != "hello" {
		t.Fatalf("a redirect that stays on the allowlist should work: %v", err)
	}
}

func TestFetcherIgnoresProxyEnvironment(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:9")
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:9")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("direct")) }))
	defer srv.Close()
	host := strings.Split(strings.TrimPrefix(srv.URL, "http://"), ":")[0]
	f := NewSafeFetcher(SafeFetchConfig{AllowedHosts: []string{host}, testing: true})
	if res, err := f.Get(context.Background(), srv.URL); err != nil || string(res.Body) != "direct" {
		t.Fatalf("proxy env var was honoured or fetch failed: %v", err)
	}
}
