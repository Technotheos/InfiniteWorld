package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

// ---------------------------------------------------------------------------
// SSRF defence: the ONLY way server code should fetch a URL a user influenced
// (link previews, avatar-by-URL, webhooks, imports...).
//
// Nothing in the server fetches user-supplied URLs today. This exists so the
// first feature that does can't open a hole. Layers, all of which must pass:
//
//  1. Deny by default: the host must be on OUTBOUND_ALLOWED_HOSTS.
//  2. https only, port 443 only, no credentials in the URL, no IP-literal hosts.
//  3. The connection itself is checked: after DNS resolves, every address the
//     dialer is about to connect to is tested against a blocklist of loopback,
//     private, link-local (cloud metadata 169.254.169.254), CGNAT and other
//     internal ranges. Checking at connect time defeats DNS rebinding.
//  4. Redirects are followed at most 3 times and each hop is re-validated.
//  5. No environment proxies, a hard timeout and a response size cap.
// ---------------------------------------------------------------------------

var (
	ErrFetchBlocked  = errors.New("outbound request blocked")
	ErrFetchTooLarge = errors.New("response too large")
)

// blockedPrefixes are destinations a server-side fetch must never reach.
var blockedPrefixes = mustPrefixes(
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
	"172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
	"198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
	"::/128", "::1/128", "64:ff9b::/96", "100::/64", "2001:db8::/32", "2002::/16",
	"fc00::/7", "fe80::/10", "ff00::/8",
)

func mustPrefixes(list ...string) []netip.Prefix {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}

// isBlockedIP reports whether ip is an internal or non-public address.
func isBlockedIP(ip netip.Addr) bool {
	ip = ip.Unmap() // ::ffff:127.0.0.1 is 127.0.0.1
	if !ip.IsValid() || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	return inPrefixes(ip, blockedPrefixes)
}

type SafeFetchConfig struct {
	// AllowedHosts: exact names ("api.example.com") or "*.example.com".
	// Empty means every request is refused.
	AllowedHosts []string
	MaxBytes     int64         // default 1 MiB
	Timeout      time.Duration // default 5s

	// testing relaxes scheme, port, IP-literal and loopback checks so unit
	// tests can talk to httptest servers. The host allowlist still applies.
	testing bool
}

type SafeFetcher struct {
	cfg    SafeFetchConfig
	client *http.Client
}

type FetchResult struct {
	Status      int
	ContentType string
	Body        []byte
}

func NewSafeFetcher(cfg SafeFetchConfig) *SafeFetcher {
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = 1 << 20
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	f := &SafeFetcher{cfg: cfg}

	dialer := &net.Dialer{
		Timeout: 3 * time.Second,
		// Control runs after DNS resolution, once per connection attempt, with
		// the literal IP about to be dialled. This is the SSRF/rebinding guard.
		Control: func(network, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil {
				return fmt.Errorf("%w: bad address", ErrFetchBlocked)
			}
			if !cfg.testing && isBlockedIP(ap.Addr()) {
				return fmt.Errorf("%w: destination is not a public address", ErrFetchBlocked)
			}
			return nil
		},
	}
	f.client = &http.Client{
		Timeout: cfg.Timeout,
		Transport: &http.Transport{
			Proxy:                  nil, // never honour HTTP(S)_PROXY from the environment
			DialContext:            dialer.DialContext,
			DisableKeepAlives:      true,
			TLSHandshakeTimeout:    3 * time.Second,
			ResponseHeaderTimeout:  cfg.Timeout,
			MaxResponseHeaderBytes: 16 << 10,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("%w: too many redirects", ErrFetchBlocked)
			}
			return f.validate(req.URL)
		},
	}
	return f
}

// outboundFetcher builds the fetcher from OUTBOUND_ALLOWED_HOSTS (comma
// separated). With the variable unset it refuses everything.
func outboundFetcher() *SafeFetcher {
	var hosts []string
	for _, h := range strings.Split(os.Getenv("OUTBOUND_ALLOWED_HOSTS"), ",") {
		if h = strings.TrimSpace(h); h != "" {
			hosts = append(hosts, h)
		}
	}
	return NewSafeFetcher(SafeFetchConfig{AllowedHosts: hosts})
}

func (f *SafeFetcher) hostAllowed(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, rule := range f.cfg.AllowedHosts {
		rule = strings.ToLower(strings.TrimSpace(rule))
		switch {
		case rule == "":
		case strings.HasPrefix(rule, "*."):
			if strings.HasSuffix(host, rule[1:]) && len(host) > len(rule)-1 {
				return true
			}
		case host == rule:
			return true
		}
	}
	return false
}

// validate applies every check that can be made before connecting.
func (f *SafeFetcher) validate(u *url.URL) error {
	blocked := func(why string) error { return fmt.Errorf("%w: %s", ErrFetchBlocked, why) }

	if u == nil || u.Host == "" {
		return blocked("missing host")
	}
	if u.User != nil {
		return blocked("credentials in URL")
	}
	if !f.cfg.testing && u.Scheme != "https" {
		return blocked("only https is allowed")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return blocked("unsupported scheme")
	}
	if p := u.Port(); !f.cfg.testing && p != "" && p != "443" {
		return blocked("only port 443 is allowed")
	}
	host := u.Hostname()
	if !f.cfg.testing {
		if _, err := netip.ParseAddr(host); err == nil {
			return blocked("IP-literal hosts are not allowed")
		}
		for _, r := range host { // punycode only: no look-alike Unicode hosts
			if r > 0x7e || r < 0x20 {
				return blocked("non-ASCII host")
			}
		}
	}
	if !f.hostAllowed(host) {
		return blocked("host is not on the allowlist")
	}
	return nil
}

// Get fetches rawURL if, and only if, every layer above allows it.
func (f *SafeFetcher) Get(ctx context.Context, rawURL string) (*FetchResult, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid URL", ErrFetchBlocked)
	}
	if err := f.validate(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "infinite-world-fetcher/1")
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.ContentLength > f.cfg.MaxBytes {
		return nil, ErrFetchTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.cfg.MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > f.cfg.MaxBytes {
		return nil, ErrFetchTooLarge
	}
	return &FetchResult{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), Body: body}, nil
}
