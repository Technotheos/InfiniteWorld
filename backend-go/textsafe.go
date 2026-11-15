package main

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ---------------------------------------------------------------------------
// Text hygiene for anything a user can type and another user will see.
//
// React escapes text on render, so this is defence in depth: it removes
// characters that can spoof or hide content ("Trojan Source" bidi overrides,
// zero-width characters, control codes) and enforces a length.
// ---------------------------------------------------------------------------

// isUnsafeRune reports code points that are never wanted in user text.
// newline is allowed only when the caller says so.
func isUnsafeRune(r rune, allowNewline bool) bool {
	switch {
	case r == '\n':
		return !allowNewline
	case r == '\t':
		return true
	case unicode.IsControl(r): // C0, DEL, C1 (includes U+0085)
		return true
	case r >= 0x202A && r <= 0x202E: // bidi embeddings / overrides
		return true
	case r >= 0x2066 && r <= 0x2069: // bidi isolates
		return true
	case r >= 0x200B && r <= 0x200F: // zero-width space/joiners, LRM, RLM
		return true
	case r == 0x2028 || r == 0x2029: // line / paragraph separators
		return true
	case r == 0x2060 || r == 0xFEFF || r == 0x00AD: // word joiner, BOM, soft hyphen
		return true
	case r == utf8.RuneError:
		return true
	}
	return false
}

// hasUnsafeText reports whether s contains anything stripText would remove.
func hasUnsafeText(s string, allowNewline bool) bool {
	if !utf8.ValidString(s) {
		return true
	}
	for _, r := range s {
		if isUnsafeRune(r, allowNewline) {
			return true
		}
	}
	return false
}

// stripText removes unsafe code points, trims, and caps the length (in runes).
func stripText(s string, maxRunes int, allowNewline bool) string {
	var b strings.Builder
	n := 0
	for _, r := range strings.ToValidUTF8(s, "") {
		if isUnsafeRune(r, allowNewline) {
			continue
		}
		b.WriteRune(r)
		if n++; maxRunes > 0 && n >= maxRunes {
			break
		}
	}
	return strings.TrimSpace(b.String())
}

// requireCleanText is the strict variant for fields that should be rejected,
// not silently altered (bios, names).
func requireCleanText(s string, maxRunes int, allowNewline bool) error {
	if hasUnsafeText(s, allowNewline) {
		return errors.New("contains invalid characters")
	}
	if utf8.RuneCountInString(s) > maxRunes {
		return errors.New("is too long")
	}
	return nil
}
