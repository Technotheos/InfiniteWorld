package main

import "testing"

func TestStripTextRemovesSpoofingCharacters(t *testing.T) {
	cases := map[string]string{
		"hello":                 "hello",
		"  padded  ":            "padded",
		"a\x00b\x07c":           "abc",
		"evil\u202eexe.txt":     "evilexe.txt", // right-to-left override
		"a\u2066b\u2069c":       "abc",         // bidi isolates
		"zero\u200bwidth\u200d": "zerowidth",
		"bom\ufeffhere":         "bomhere",
		"line\u2028break":       "linebreak",
		"tab\there":             "tabhere",
		"multi\nline":           "multiline",
		"ünïcödé 日本語 🙂":         "ünïcödé 日本語 🙂",
		"bad\xff\xfeutf8":       "badutf8",
	}
	for in, want := range cases {
		if got := stripText(in, 100, false); got != want {
			t.Errorf("stripText(%q) = %q, want %q", in, got, want)
		}
	}
	if got := stripText("multi\nline", 100, true); got != "multi\nline" {
		t.Errorf("newline should survive when allowed: %q", got)
	}
	if got := stripText("abcdefgh", 3, false); got != "abc" {
		t.Errorf("length cap: %q", got)
	}
}

func TestRequireCleanText(t *testing.T) {
	if requireCleanText("fine text", 20, false) != nil {
		t.Error("clean text rejected")
	}
	for _, bad := range []string{"a\x00b", "x\u202ey", "z\u200bw"} {
		if requireCleanText(bad, 20, false) == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if requireCleanText("way too long for this", 5, false) == nil {
		t.Error("length not enforced")
	}
}

func TestBioRejectsBidiAndZeroWidth(t *testing.T) {
	for _, bad := range []string{"hi\u202ethere", "hi\u200bthere", "a\x00b"} {
		if _, err := validateBio(bad); err == nil {
			t.Errorf("validateBio(%q) should fail", bad)
		}
	}
	if got, err := validateBio("  line one\nline two  "); err != nil || got != "line one\nline two" {
		t.Errorf("normal bio: %q %v", got, err)
	}
}

func TestCleanChatDropsInvisibleOverrides(t *testing.T) {
	if got := cleanChat("hi\u202e there\u200b!"); got != "hi there!" {
		t.Errorf("cleanChat: %q", got)
	}
	if got := cleanChat("a\x00b"); got != "a b" { // control characters still become spaces
		t.Errorf("cleanChat control: %q", got)
	}
}
