package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Starship Studio: the audio pipeline.
//
// Every upload (a recorded take or a track for the Listening Lounge) goes
// through the same steps, in this order, and fails closed at each of them:
//
//  1. size cap while streaming to a private temp file (never trust Content-Length)
//  2. real type from MAGIC BYTES. Extension and the browser's claim are ignored.
//     Only WAV, MP3, OGG, FLAC and WebM are accepted. SVG, HTML, etc. never pass.
//  3. optional ClamAV scan (clamdscan)
//  4. ffprobe in the sandbox: container must match the magic bytes, the first
//     audio stream must use an allow-listed codec, sane rate/channels/duration
//  5. ffmpeg re-encode in the sandbox to AAC/MP4: no network, CPU/memory/file
//     size limits, hard timeout, all metadata stripped, only ONE audio stream kept
//  6. stored under a random ID, in STUDIO_DATA_DIR (outside any web root).
//     The uploader's filename is never used for anything.
//
// Playback is by short-lived signed URL plus a room-membership check on every
// fetch (see studio_http.go).
// ---------------------------------------------------------------------------

const (
	studioMaxUploadBytes   = 24 << 20  // raw upload, before re-encoding
	studioMaxOutBytes      = 40 << 20  // after re-encoding
	studioMaxTakeSecs      = 180       // a recorded take
	studioMaxTrackSecs     = 480       // a track uploaded to the Lounge
	studioUserQuotaBytes   = 150 << 20 // stored bytes per user
	studioUserMaxItems     = 60
	studioTranscodeTimeout = 60 * time.Second
	studioProbeTimeout     = 15 * time.Second
	studioSigTTL           = 60 * time.Second
	studioTmpMaxAge        = 10 * time.Minute
	studioOrphanMinAge     = time.Hour
	studioMinDurMs         = 200
)

var (
	errStudioType     = errors.New("that file is not a supported audio format (WAV, MP3, OGG, FLAC or WebM only)")
	errStudioTooBig   = errors.New("that file is too large")
	errStudioLong     = errors.New("that recording is too long")
	errStudioBad      = errors.New("that audio file could not be read safely")
	errStudioInfected = errors.New("that file was rejected by the virus scan")
	errStudioQuota    = errors.New("you have used all of your studio storage; delete a take first")
	errStudioNoTools  = errors.New("audio processing is not available on this server")
)

// ---- 2. magic bytes ---------------------------------------------------------

type audioKind string

const (
	kindWAV  audioKind = "wav"
	kindMP3  audioKind = "mp3"
	kindOGG  audioKind = "ogg"
	kindFLAC audioKind = "flac"
	kindWebM audioKind = "webm"
)

// sniffAudio decides what a file really is from its first bytes.
func sniffAudio(head []byte) (audioKind, bool) {
	n := len(head)
	switch {
	case n >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WAVE":
		return kindWAV, true
	case n >= 4 && string(head[0:4]) == "OggS":
		return kindOGG, true
	case n >= 4 && string(head[0:4]) == "fLaC":
		return kindFLAC, true
	case n >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3:
		// EBML. Matroska and WebM share it: the DocType says which. Video-capable
		// Matroska is not accepted, only files that declare themselves "webm".
		lim := n
		if lim > 64 {
			lim = 64
		}
		if bytes.Contains(head[:lim], []byte("webm")) {
			return kindWebM, true
		}
		return "", false
	case n >= 3 && string(head[0:3]) == "ID3":
		return kindMP3, true
	case n >= 4 && head[0] == 0xFF && head[1]&0xE0 == 0xE0:
		// MPEG audio frame sync. Version 01 and layer 00 are reserved, which also
		// keeps raw AAC (ADTS, layer bits 00) out.
		version := (head[1] >> 3) & 0x03
		layer := (head[1] >> 1) & 0x03
		if version != 0x01 && layer != 0x00 {
			return kindMP3, true
		}
	}
	return "", false
}

// ---- sandbox ----------------------------------------------------------------

type studioTools struct {
	ffmpeg, ffprobe, clam string
	netns                 bool // unshare -rn works: the child has no network at all
	requireAV             bool
	memKB                 int
}

var studioBin studioTools

// initStudioTools finds ffmpeg/ffprobe/clamdscan once at startup.
func initStudioTools() {
	t := studioTools{requireAV: os.Getenv("STUDIO_REQUIRE_AV") == "1", memKB: 3 << 20}
	t.ffmpeg, _ = exec.LookPath("ffmpeg")
	t.ffprobe, _ = exec.LookPath("ffprobe")
	if os.Getenv("STUDIO_AV") != "off" {
		t.clam, _ = exec.LookPath("clamdscan")
	}
	if v, err := strconv.Atoi(os.Getenv("STUDIO_FFMPEG_MEM_KB")); err == nil && v >= 262144 {
		t.memKB = v
	}
	if os.Getenv("STUDIO_NETNS") != "off" {
		if _, err := exec.LookPath("unshare"); err == nil {
			probe := exec.Command("unshare", "-rn", "true")
			if probe.Run() == nil {
				t.netns = true
			}
		}
	}
	studioBin = t
	switch {
	case t.ffmpeg == "" || t.ffprobe == "":
		log.Printf("[STUDIO] ffmpeg/ffprobe not found: uploads are disabled")
	default:
		log.Printf("[STUDIO] audio sandbox: netns=%v clamav=%v", t.netns, t.clam != "")
		if !t.netns {
			log.Printf("[STUDIO] WARNING: could not create a network-less namespace (unshare -rn); ffmpeg still runs with -protocol_whitelist file and no environment. Run the server in a container with no egress for full isolation.")
		}
		if t.clam == "" {
			if t.requireAV {
				log.Printf("[STUDIO] STUDIO_REQUIRE_AV=1 but clamdscan is missing: uploads will be refused")
			} else {
				log.Printf("[STUDIO] WARNING: no antivirus scanner (clamdscan) found; uploads are still re-encoded, but not scanned")
			}
		}
	}
}

func (t studioTools) ready() bool {
	if t.ffmpeg == "" || t.ffprobe == "" {
		return false
	}
	if t.requireAV && t.clam == "" {
		return false
	}
	return true
}

// sandboxed builds a command that runs with no environment, a CPU-time limit,
// an address-space limit, a file-size limit and (when available) no network.
// The context deadline is the wall-clock limit.
func (t studioTools) sandboxed(ctx context.Context, dir, prog string, args ...string) *exec.Cmd {
	// One ulimit per call: dash (the usual /bin/sh) accepts a single resource each time.
	const script = `ulimit -t 50 2>/dev/null; ulimit -v "$0" 2>/dev/null; ulimit -f 90000 2>/dev/null; ulimit -n 64 2>/dev/null; exec "$@"`
	inner := append([]string{"sh", "-c", script, strconv.Itoa(t.memKB), prog}, args...)
	// sh -c 'script' ARG0 ARG1...: $0 is the memory limit, "$@" starts at ARG1.
	var cmd *exec.Cmd
	if t.netns {
		cmd = exec.CommandContext(ctx, "unshare", append([]string{"-rn"}, inner...)...)
	} else {
		cmd = exec.CommandContext(ctx, inner[0], inner[1:]...)
	}
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "LC_ALL=C"}
	cmd.Dir = dir
	return cmd
}

// capBuf keeps at most max bytes and silently discards the rest, so a noisy
// child process can neither fill memory nor stall on a short write.
type capBuf struct {
	buf *bytes.Buffer
	max int
}

func (c *capBuf) Write(p []byte) (int, error) {
	if room := c.max - c.buf.Len(); room > 0 {
		if len(p) < room {
			room = len(p)
		}
		c.buf.Write(p[:room])
	}
	return len(p), nil
}

// ---- 4. probe ---------------------------------------------------------------

type probeOut struct {
	Streams []struct {
		CodecType  string `json:"codec_type"`
		CodecName  string `json:"codec_name"`
		SampleRate string `json:"sample_rate"`
		Channels   int    `json:"channels"`
	} `json:"streams"`
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
	} `json:"format"`
}

var allowedCodecs = map[string]bool{
	"pcm_s16le": true, "pcm_s24le": true, "pcm_s32le": true, "pcm_f32le": true, "pcm_u8": true,
	"mp3": true, "vorbis": true, "opus": true, "flac": true,
}

func demuxerFor(k audioKind) string {
	switch k {
	case kindWAV:
		return "wav"
	case kindMP3:
		return "mp3"
	case kindOGG:
		return "ogg"
	case kindFLAC:
		return "flac"
	default:
		return "matroska"
	}
}

func (t studioTools) probe(ctx context.Context, dir, path string, kind audioKind, maxSecs int) error {
	ctx, cancel := context.WithTimeout(ctx, studioProbeTimeout)
	defer cancel()
	cmd := t.sandboxed(ctx, dir, t.ffprobe,
		"-v", "error", "-protocol_whitelist", "file", "-f", demuxerFor(kind),
		"-probesize", "5000000", "-analyzeduration", "5000000",
		"-show_entries", "format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels",
		"-of", "json", path)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &capBuf{buf: &out, max: 1 << 16}, &capBuf{buf: &errb, max: 1 << 12}
	if err := cmd.Run(); err != nil {
		return errStudioBad
	}
	var p probeOut
	if json.Unmarshal(out.Bytes(), &p) != nil || len(p.Streams) == 0 || len(p.Streams) > 8 {
		return errStudioBad
	}
	// The container ffprobe found must be the one the magic bytes said.
	if !strings.Contains(p.Format.FormatName, demuxerFor(kind)) && !(kind == kindWebM && strings.Contains(p.Format.FormatName, "webm")) {
		return errStudioBad
	}
	first := -1
	for i, s := range p.Streams {
		if s.CodecType == "audio" {
			first = i
			break
		}
	}
	if first < 0 {
		return errStudioBad
	}
	s := p.Streams[first]
	if !allowedCodecs[s.CodecName] {
		return errStudioType
	}
	if s.SampleRate != "" {
		if sr, err := strconv.Atoi(s.SampleRate); err != nil || sr < 8000 || sr > 192000 {
			return errStudioBad
		}
	}
	if s.Channels < 1 || s.Channels > 8 {
		return errStudioBad
	}
	// WebM from a browser recorder has no duration in its header; everything else does.
	// A declared duration far past the cap is a bomb: refuse before decoding a frame.
	if p.Format.Duration != "" && p.Format.Duration != "N/A" {
		d, err := strconv.ParseFloat(p.Format.Duration, 64)
		if err != nil || math.IsNaN(d) || math.IsInf(d, 0) || d < 0 {
			return errStudioBad
		}
		if d > float64(maxSecs)+1 {
			return errStudioLong
		}
	}
	return nil
}

// ---- 5. re-encode -----------------------------------------------------------

func (t studioTools) transcode(ctx context.Context, dir, in, out string, kind audioKind, maxSecs int) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, studioTranscodeTimeout)
	defer cancel()
	cmd := t.sandboxed(ctx, dir, t.ffmpeg,
		"-nostdin", "-hide_banner", "-loglevel", "error", "-nostats",
		"-protocol_whitelist", "file", "-threads", "1",
		"-f", demuxerFor(kind), "-probesize", "5000000", "-analyzeduration", "5000000", "-i", in,
		"-map", "0:a:0", "-vn", "-sn", "-dn",
		"-map_metadata", "-1", "-map_chapters", "-1",
		"-t", strconv.Itoa(maxSecs+1), "-ac", "2", "-ar", "44100",
		"-c:a", "aac", "-b:a", "160k",
		"-fflags", "+bitexact", "-flags:a", "+bitexact", "-movflags", "+faststart",
		"-fs", strconv.Itoa(studioMaxOutBytes), "-f", "mp4", "-y", out)
	var errb bytes.Buffer
	cmd.Stderr = &capBuf{buf: &errb, max: 1 << 12}
	if err := cmd.Run(); err != nil {
		log.Printf("[STUDIO] transcode failed: %v", err) // metadata only, never audio
		return 0, errStudioBad
	}
	st, err := os.Stat(out)
	if err != nil || st.Size() == 0 || st.Size() > studioMaxOutBytes {
		return 0, errStudioBad
	}
	// Measure the result (the input may not have declared a duration).
	pctx, pcancel := context.WithTimeout(ctx, studioProbeTimeout)
	defer pcancel()
	pc := t.sandboxed(pctx, dir, t.ffprobe, "-v", "error", "-protocol_whitelist", "file",
		"-show_entries", "format=duration", "-of", "json", out)
	var pb bytes.Buffer
	pc.Stdout = &capBuf{buf: &pb, max: 1 << 12}
	if err := pc.Run(); err != nil {
		return 0, errStudioBad
	}
	var po probeOut
	if json.Unmarshal(pb.Bytes(), &po) != nil {
		return 0, errStudioBad
	}
	d, err := strconv.ParseFloat(po.Format.Duration, 64)
	if err != nil || math.IsNaN(d) || d < 0 {
		return 0, errStudioBad
	}
	ms := int(d * 1000)
	if ms < studioMinDurMs {
		return 0, errStudioBad
	}
	if ms > maxSecs*1000+500 {
		return 0, errStudioLong
	}
	return ms, nil
}

// ---- 3. antivirus -----------------------------------------------------------

func (t studioTools) scan(ctx context.Context, path string) error {
	if t.clam == "" {
		if t.requireAV {
			return errStudioNoTools
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.clam, "--no-summary", "--fdpass", path)
	err := cmd.Run()
	if err == nil {
		return nil
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) && ee.ExitCode() == 1 {
		return errStudioInfected
	}
	log.Printf("[STUDIO] antivirus error: %v", err)
	if t.requireAV {
		return errStudioNoTools
	}
	return nil
}

// ---- storage ----------------------------------------------------------------

// studioItem is the metadata of one stored recording or track. No audio, no
// filename of the uploader, nothing but what the room needs to show it.
type studioItem struct {
	ID           string
	Room         string
	Owner        string
	Kind         string // "take" or "track"
	Title        string
	Path         string
	Bytes        int64
	DurMs        int
	StartBeat    int
	LenBeats     int
	Contributors []string        // everyone who must agree before this is published
	Consent      map[string]bool // contributor -> agreed
	Published    bool
	Quarantined  bool // enough reports: hidden until a moderator looks
	Removed      bool
	Reporters    map[string]bool
	CreatedAt    time.Time
	ClosedAt     time.Time // when its room closed (zero while open)
}

type studioFiles struct {
	mu    sync.Mutex
	dir   string
	tmp   string
	items map[string]*studioItem
	bytes map[string]int64
	count map[string]int
}

var studioStore = &studioFiles{items: map[string]*studioItem{}, bytes: map[string]int64{}, count: map[string]int{}}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func initStudioStorage() error {
	dir := os.Getenv("STUDIO_DATA_DIR")
	if dir == "" {
		dir = "./studio-data"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	tmp := filepath.Join(abs, "tmp")
	for _, d := range []string{abs, filepath.Join(abs, "media"), tmp} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	studioStore.mu.Lock()
	studioStore.dir, studioStore.tmp = abs, tmp
	studioStore.mu.Unlock()
	return nil
}

func (s *studioFiles) tmpFile() (*os.File, error) {
	return os.CreateTemp(s.tmp, "up-*")
}

// reserve checks the per-user caps. The check is repeated in commit under the
// same lock, so two parallel uploads cannot both squeeze past the limit.
func (s *studioFiles) quotaOK(owner string, add int64) bool {
	return s.bytes[owner]+add <= studioUserQuotaBytes && s.count[owner] < studioUserMaxItems
}

// ingest runs the whole pipeline on a raw upload that is already on disk.
func (s *studioFiles) ingest(ctx context.Context, owner, room, kind, title, rawPath string) (*studioItem, error) {
	if !studioBin.ready() {
		return nil, errStudioNoTools
	}
	s.mu.Lock()
	over := !s.quotaOK(owner, 0)
	s.mu.Unlock()
	if over {
		return nil, errStudioQuota
	}

	f, err := os.Open(rawPath)
	if err != nil {
		return nil, errStudioBad
	}
	head := make([]byte, 64)
	n, _ := io.ReadFull(f, head)
	f.Close()
	k, ok := sniffAudio(head[:n])
	if !ok {
		return nil, errStudioType
	}
	maxSecs := studioMaxTakeSecs
	if kind == "track" {
		maxSecs = studioMaxTrackSecs
	}

	if err := studioBin.scan(ctx, rawPath); err != nil {
		return nil, err
	}
	if err := studioBin.probe(ctx, s.tmp, rawPath, k, maxSecs); err != nil {
		return nil, err
	}

	id := randHex(16)
	final := filepath.Join(s.dir, "media", id+".m4a")
	ms, err := studioBin.transcode(ctx, s.tmp, rawPath, final, k, maxSecs)
	if err != nil {
		os.Remove(final)
		return nil, err
	}
	st, err := os.Stat(final)
	if err != nil {
		return nil, errStudioBad
	}
	_ = os.Chmod(final, 0o600)

	it := &studioItem{ID: id, Room: room, Owner: owner, Kind: kind, Title: title, Path: final,
		Bytes: st.Size(), DurMs: ms, Consent: map[string]bool{}, Reporters: map[string]bool{}, CreatedAt: time.Now()}

	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.quotaOK(owner, st.Size()) {
		os.Remove(final)
		return nil, errStudioQuota
	}
	s.items[id] = it
	s.bytes[owner] += st.Size()
	s.count[owner]++
	log.Printf("[STUDIO] stored %s kind=%s bytes=%d dur_ms=%d room=%s", id, kind, st.Size(), ms, room)
	return it, nil
}

func (s *studioFiles) get(id string) *studioItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	it := s.items[id]
	if it == nil || it.Removed {
		return nil
	}
	return it
}

// view returns a private copy, safe to read without any lock.
func (s *studioFiles) view(id string) (studioItem, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	it := s.items[id]
	if it == nil || it.Removed {
		return studioItem{}, false
	}
	c := *it
	c.Contributors = append([]string(nil), it.Contributors...)
	c.Consent = make(map[string]bool, len(it.Consent))
	for k, v := range it.Consent {
		c.Consent[k] = v
	}
	c.Reporters = nil
	return c, true
}

// drop deletes the file and frees the owner's quota. Safe to call twice.
func (s *studioFiles) drop(id string) {
	s.mu.Lock()
	it := s.items[id]
	if it == nil {
		s.mu.Unlock()
		return
	}
	delete(s.items, id)
	s.bytes[it.Owner] -= it.Bytes
	if s.bytes[it.Owner] <= 0 {
		delete(s.bytes, it.Owner)
	}
	if s.count[it.Owner]--; s.count[it.Owner] <= 0 {
		delete(s.count, it.Owner)
	}
	path := it.Path
	s.mu.Unlock()
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Printf("[STUDIO] could not delete %s: %v", id, err)
	}
}

func (s *studioFiles) markRoomClosed(code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for _, it := range s.items {
		if it.Room == code && it.ClosedAt.IsZero() {
			it.ClosedAt = now
		}
	}
}

func studioRetention() time.Duration {
	if h, err := strconv.Atoi(os.Getenv("STUDIO_RETENTION_HOURS")); err == nil && h >= 1 && h <= 24*30 {
		return time.Duration(h) * time.Hour
	}
	return 24 * time.Hour
}

// sweep deletes expired items, orphaned files and stale temp files.
// It is the only place that decides how long anything lives.
func (s *studioFiles) sweep(now time.Time) {
	keep := studioRetention()
	var dead []string
	s.mu.Lock()
	known := make(map[string]bool, len(s.items))
	for id, it := range s.items {
		known[id+".m4a"] = true
		age := now.Sub(it.CreatedAt)
		closedFor := time.Duration(0)
		if !it.ClosedAt.IsZero() {
			closedFor = now.Sub(it.ClosedAt)
		}
		if age > keep || (!it.Published && closedFor > time.Hour) {
			dead = append(dead, id)
		}
	}
	dir, tmp := s.dir, s.tmp
	s.mu.Unlock()
	for _, id := range dead {
		s.drop(id)
	}
	if dir == "" {
		return
	}
	clean := func(d string, minAge time.Duration, skip func(name string) bool) {
		ents, err := os.ReadDir(d)
		if err != nil {
			return
		}
		for _, e := range ents {
			if e.IsDir() || (skip != nil && skip(e.Name())) {
				continue
			}
			info, err := e.Info()
			if err != nil || now.Sub(info.ModTime()) < minAge {
				continue
			}
			_ = os.Remove(filepath.Join(d, e.Name()))
		}
	}
	// Anything on disk that the index does not know about (a crash, a restart) is an orphan.
	clean(filepath.Join(dir, "media"), studioOrphanMinAge, func(n string) bool { return known[n] })
	clean(tmp, studioTmpMaxAge, nil)
}

// ---- signing ----------------------------------------------------------------

// studioKey is derived from the server secret, so a leaked media URL or ticket
// can never be turned into a login token (and the other way round).
func studioKey(purpose string) []byte {
	m := hmac.New(sha256.New, jwtKey)
	m.Write([]byte("studio/v1/" + purpose))
	return m.Sum(nil)
}

func studioMAC(purpose string, parts ...string) string {
	m := hmac.New(sha256.New, studioKey(purpose))
	for _, p := range parts {
		m.Write([]byte(p))
		m.Write([]byte{0}) // separator: ("ab","c") must not equal ("a","bc")
	}
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func macEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// signMedia returns the query string for a media URL valid for studioSigTTL, bound to one user and one item.
func signMedia(id, user string) string {
	exp := time.Now().Add(studioSigTTL).Unix()
	e := strconv.FormatInt(exp, 10)
	return fmt.Sprintf("u=%s&e=%s&s=%s", user, e, studioMAC("media", id, user, e))
}

func verifyMedia(id, user, e, sig string) bool {
	exp, err := strconv.ParseInt(e, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return macEqual(studioMAC("media", id, user, e), sig)
}

// A room ticket is the short-lived, single-use, room-scoped credential for the
// WebSocket. It is issued only after the room's rules (locked, invite-only,
// friends-only, kicked) said yes, and it carries the JWT's own expiry so the
// socket cannot outlive the login that opened it.
const studioTicketTTL = 45 * time.Second

func makeTicket(room, user string, jwtExp time.Time) string {
	exp := time.Now().Add(studioTicketTTL).Unix()
	payload := strings.Join([]string{room, user, strconv.FormatInt(exp, 10), strconv.FormatInt(jwtExp.Unix(), 10), randHex(8)}, "|")
	b := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return b + "." + studioMAC("ticket", payload)
}

type studioTicket struct {
	Room, User, Nonce string
	JWTExp            time.Time
}

func parseTicket(tok string) (studioTicket, bool) {
	i := strings.IndexByte(tok, '.')
	if i < 1 || len(tok) > 512 {
		return studioTicket{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(tok[:i])
	if err != nil {
		return studioTicket{}, false
	}
	payload := string(raw)
	if !macEqual(studioMAC("ticket", payload), tok[i+1:]) {
		return studioTicket{}, false
	}
	f := strings.Split(payload, "|")
	if len(f) != 5 {
		return studioTicket{}, false
	}
	exp, err1 := strconv.ParseInt(f[2], 10, 64)
	jexp, err2 := strconv.ParseInt(f[3], 10, 64)
	if err1 != nil || err2 != nil || time.Now().Unix() > exp {
		return studioTicket{}, false
	}
	return studioTicket{Room: f[0], User: f[1], Nonce: f[4], JWTExp: time.Unix(jexp, 0)}, true
}
