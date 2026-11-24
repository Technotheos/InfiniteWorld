import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, LogOut } from 'lucide-react';
import '../styles/celestial.css';
import { Starfield } from '../components/Starfield';
import { isNetworkError } from '../components/authApi';
import { BTN_GHOST, BTN_GOLD, Expand, FOCUS, FieldError, INPUT } from '../components/formKit';
import {
  AuthExpiredError, MIN_PASSWORD, changePassword, getMe, listSessions, logoutEverywhere, revokeSession,
  type Profile, type SessionInfo,
} from '../components/profileApi';
import { usePrefs, type Prefs } from '../hooks/usePrefs';
import { Ambient, sfx, useSoundPrefs } from '../sound';
import { getPrivacy, savePrivacy, type Policy, type Privacy } from '../social/socialApi';

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface SettingsProps {
  token: string;
  username: string;
  onBack: () => void;
  onLogout: () => void;
  /** The server issued a new token (after a username change). */
  onSessionChange: (token: string, username: string, expiresIn: number) => void;
  /** Open the admin console (only offered to staff). */
  onOpenAdmin?: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                              */
/* -------------------------------------------------------------------------- */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="iw-display text-3xl font-light">{title}</h3>
        {hint && <p className="mt-1 text-sm text-[#a49fb0]">{hint}</p>}
      </div>
      <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md">
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children, stack = false }: { label: string; hint?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`px-5 py-4 sm:px-6 ${stack ? 'space-y-3' : 'flex items-center justify-between gap-4'}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[#eee9dc]">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-[#a49fb0]">{hint}</div>}
      </div>
      {children && <div className={stack ? '' : 'shrink-0'}>{children}</div>}
    </div>
  );
}

function VolumeSlider({ value, label, onChange, onCommit }: { value: number; label: string; onChange: (v: number) => void; onCommit?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className={`w-36 accent-[#e9b872] sm:w-48 ${FOCUS}`}
      />
      <span className="w-9 text-right text-xs tabular-nums text-[#a49fb0]">{Math.round(value * 100)}%</span>
    </div>
  );
}

const POLICY_LABEL: Record<Policy, string> = { everyone: 'Everyone', friends: 'Friends', nobody: 'Nobody' };

/** Three pill buttons instead of a native dropdown, so the choices match the rest of the page. */
function PolicySelect({ value, label, onChange }: { value: Policy; label: string; onChange: (v: Policy) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
      {(Object.keys(POLICY_LABEL) as Policy[]).map((p) => {
        const on = value === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => !on && onChange(p)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
              on ? 'bg-[#e9b872] text-[#1a1208]' : 'text-[#c9c4d2] hover:bg-white/5 hover:text-[#eee9dc]'
            } ${FOCUS}`}
          >
            {POLICY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full border transition-colors ${
        on ? 'border-[#e9b872] bg-[#e9b872]/90' : 'border-white/15 bg-white/5'
      } ${FOCUS}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform ${
          on ? 'translate-x-5 bg-[#1a1208]' : 'bg-[#a49fb0]'
        }`}
      />
    </button>
  );
}

/** "Chrome on Linux" from a User-Agent string (good enough for a device list). */
function describeAgent(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux|X11/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const PREF_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'starfield', label: 'Starfield', hint: 'The moving stars behind every screen.' },
  { key: 'warp', label: 'Warp jump', hint: 'The hyperspace flash when you enter a room.' },
  { key: 'ambient', label: 'Ambient motion', hint: 'Drifting glow, turning rings and soft pulses.' },
];

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export default function Settings({ token, username, onBack, onLogout, onSessionChange, onOpenAdmin }: SettingsProps) {
  const reduce = useReducedMotion();
  const [prefs, setPref] = usePrefs();
  const [sound, setSound] = useSoundPrefs();
  const [me, setMe] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState('');
  const panelRef = useRef<HTMLElement | null>(null);

  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [privacyError, setPrivacyError] = useState('');

  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<SessionInfo[] | null>(null);
  const [devicesError, setDevicesError] = useState('');
  const [busyDevice, setBusyDevice] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Turns a failed request into a message, or logs out when the session is gone. */
  const explain = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof AuthExpiredError) {
        onLogout();
        return '';
      }
      if (isNetworkError(err)) return 'Cannot reach the server. Check your connection and try again.';
      return err instanceof Error && err.message ? err.message : fallback;
    },
    [onLogout],
  );

  const load = useCallback(
    async (tok: string) => {
      try {
        const p = await getMe(tok);
        setMe(p);
        setLoadError('');
      } catch (err) {
        setLoadError(explain(err, 'Could not load your profile.'));
      }
    },
    [explain],
  );

  useEffect(() => {
    void load(token);
    // Load once on open; later changes update `me` directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape goes back too (but not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  /* ---- privacy ---- */

  useEffect(() => {
    getPrivacy(token)
      .then(setPrivacy)
      .catch((err) => setPrivacyError(explain(err, 'Could not load your privacy settings.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Optimistic: the switch moves at once and snaps back if the server says no. */
  const changePrivacy = (patch: Partial<Privacy>) => {
    const before = privacy;
    setPrivacy((p) => (p ? { ...p, ...patch } : p));
    setPrivacyError('');
    savePrivacy(token, patch)
      .then(setPrivacy)
      .catch((err) => {
        setPrivacy(before);
        setPrivacyError(explain(err, 'Could not save your privacy settings.'));
      });
  };

  /* ---- password ---- */

  const closePw = () => {
    setPwOpen(false);
    setCurPw('');
    setNewPw('');
    setConfirmPw('');
    setPwError('');
  };

  const submitPw = async (e: FormEvent) => {
    e.preventDefault();
    if (savingPw) return;
    if (newPw.length < MIN_PASSWORD) {
      setPwError(`New password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('The new passwords do not match.');
      return;
    }
    setSavingPw(true);
    setPwError('');
    try {
      // Every other device is signed out; the server hands this one a fresh login.
      const res = await changePassword(token, curPw, newPw);
      onSessionChange(res.token, res.username, res.expires_in);
      closePw();
      say('Password updated. Other devices were signed out.');
    } catch (err) {
      setPwError(explain(err, 'Could not change your password.'));
    } finally {
      setSavingPw(false);
    }
  };

  /* ---- devices ---- */

  const loadDevices = async () => {
    setDevicesError('');
    try {
      setDevices((await listSessions(token)).sessions);
    } catch (err) {
      setDevicesError(explain(err, 'Could not load your devices.'));
    }
  };

  const toggleDevices = () => {
    const next = !devicesOpen;
    setDevicesOpen(next);
    setConfirmAll(false);
    if (next) void loadDevices();
  };

  const signOutDevice = async (id: string) => {
    setBusyDevice(id);
    try {
      await revokeSession(token, id);
      await loadDevices();
      say('Device signed out');
    } catch (err) {
      setDevicesError(explain(err, 'Could not sign that device out.'));
    } finally {
      setBusyDevice('');
    }
  };

  const signOutEverywhere = async () => {
    try {
      await logoutEverywhere(token);
      onLogout(); // this device too
    } catch (err) {
      setDevicesError(explain(err, 'Could not sign out of all devices.'));
    }
  };

  /* ---- render ---- */

  const rise = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.07 } };

  return (
    <div
      className={`iw-root relative min-h-screen overflow-hidden ${prefs.ambient ? '' : 'iw-calm'}`}
      // Tapping the empty space around the settings panel goes back, like the Back button.
      onMouseDown={(e) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) onBack();
      }}
    >
      {prefs.starfield && <Starfield />}
      <div
        className="iw-anim pointer-events-none absolute left-[-10%] top-[-10%] z-0 h-[520px] w-[520px] rounded-full bg-[#2a1750]/30 blur-[150px]"
        style={{ animation: 'iw-drift 26s ease-in-out infinite' }}
      />
      <div
        className="iw-anim pointer-events-none absolute bottom-[-12%] right-[-10%] z-0 h-[620px] w-[620px] rounded-full bg-[#5a3b12]/20 blur-[170px]"
        style={{ animation: 'iw-drift 32s ease-in-out infinite reverse' }}
      />

      <main ref={panelRef} className="relative z-10 mx-auto max-w-2xl space-y-10 px-5 py-8 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-[#c9c4d2] backdrop-blur-md transition hover:bg-white/5 hover:text-[#eee9dc] ${FOCUS}`}
        >
          <ArrowLeft size={16} /> Back
        </button>

        <motion.header {...rise(0)}>
          <h2 className="iw-display text-5xl font-light leading-tight">Settings</h2>
          <p className="mt-1 text-sm text-[#a49fb0]">Signed in as @{username}</p>
        </motion.header>

        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-[#ff5d4a]/30 bg-[#ff5d4a]/5 px-5 py-3 text-sm text-[#ff9b8f]">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load(token)} className={BTN_GHOST}>
              Retry
            </button>
          </div>
        )}

        {/* Appearance */}
        <motion.div {...rise(2)}>
          <Section title="Appearance" hint="Saved on this device.">
            {PREF_ROWS.map((r) => (
              <Row key={r.key} label={r.label} hint={r.hint}>
                <Switch on={prefs[r.key]} onChange={(v) => setPref(r.key, v)} label={r.label} />
              </Row>
            ))}
          </Section>
        </motion.div>

        {/* Sound */}
        <motion.div {...rise(2)}>
          <Section title="Sound" hint="Made right in your browser, so nothing to download. Sound starts after your first tap.">
            <Ambient scene="home" />
            <Row label="Mute everything" hint="Silences ambience, effects and the slugs.">
              <Switch on={sound.muted} onChange={(v) => setSound('muted', v)} label="Mute everything" />
            </Row>
            <Row label="Ambience" hint="The quiet loop that plays in each room.">
              <VolumeSlider value={sound.ambience} label="Ambience volume" onChange={(v) => setSound('ambience', v)} />
            </Row>
            <Row label="Effects" hint="Clicks, success and fail tones, the warp whoosh and slug voices.">
              <VolumeSlider value={sound.effects} label="Effects volume" onChange={(v) => setSound('effects', v)} onCommit={() => sfx('success')} />
            </Row>
          </Section>
        </motion.div>

        {/* Privacy */}
        <motion.div {...rise(2)}>
          <Section title="Privacy" hint="Friends are people you follow who follow you back.">
            {!privacy ? (
              <Row label="Loading…" />
            ) : (
              <>
                <Row label="Hide my presence" hint="Friends will see you as offline and will not see which room you are in.">
                  <Switch on={privacy.hide_presence} onChange={(v) => changePrivacy({ hide_presence: v })} label="Hide my presence" />
                </Row>
                <Row label="Who can message me" hint="Applies to new direct messages." stack>
                  <PolicySelect value={privacy.dm} label="Who can message me" onChange={(v) => changePrivacy({ dm: v })} />
                </Row>
                <Row label="Who can find me" hint="Whether you show up when someone searches by name." stack>
                  <PolicySelect value={privacy.find} label="Who can find me" onChange={(v) => changePrivacy({ find: v })} />
                </Row>
              </>
            )}
            {privacyError && <div role="alert" className="px-5 py-3 text-xs text-[#ffc9c2] sm:px-6">{privacyError}</div>}
          </Section>
        </motion.div>

        {/* Security */}
        <motion.div {...rise(3)}>
          <Section title="Account">
            <div>
              <Row label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
                <button
                  type="button"
                  onClick={() => (pwOpen ? closePw() : setPwOpen(true))}
                  aria-expanded={pwOpen}
                  className={BTN_GHOST}
                >
                  {pwOpen ? 'Cancel' : 'Change'}
                </button>
              </Row>
              <Expand open={pwOpen}>
                <form onSubmit={submitPw} className="space-y-3 px-5 pb-5 sm:px-6">
                  <input
                    type="password"
                    value={curPw}
                    onChange={(e) => setCurPw(e.target.value)}
                    placeholder="Current password"
                    aria-label="Current password"
                    autoComplete="current-password"
                    className={INPUT}
                  />
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password"
                    aria-label="New password"
                    autoComplete="new-password"
                    className={INPUT}
                  />
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder="Confirm new password"
                    aria-label="Confirm new password"
                    autoComplete="new-password"
                    className={INPUT}
                  />
                  <FieldError>{pwError}</FieldError>
                  <div className="flex justify-end">
                    <button type="submit" disabled={savingPw || !curPw || !newPw || !confirmPw} className={BTN_GOLD}>
                      {savingPw ? 'Saving…' : 'Update password'}
                    </button>
                  </div>
                </form>
              </Expand>
            </div>
            <div>
              <Row label="Devices" hint="Where you are signed in right now.">
                <button type="button" onClick={toggleDevices} aria-expanded={devicesOpen} className={BTN_GHOST}>
                  {devicesOpen ? 'Hide' : 'Manage'}
                </button>
              </Row>
              <Expand open={devicesOpen}>
                <div className="space-y-2 px-5 pb-5 sm:px-6">
                  {devices === null && !devicesError && <p className="text-xs text-[#a49fb0]">Loading…</p>}
                  {devices?.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-[#eee9dc]">
                          <span className="truncate">{describeAgent(d.user_agent)}</span>
                          {d.current && (
                            <span className="shrink-0 rounded-full border border-[#e9b872]/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#e9b872]">
                              This device
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-[#a49fb0]">
                          {d.ip || 'unknown address'} · active {ago(d.last_used)}
                        </div>
                      </div>
                      {!d.current && (
                        <button
                          type="button"
                          onClick={() => void signOutDevice(d.id)}
                          disabled={busyDevice === d.id}
                          className={`shrink-0 rounded-lg px-2 py-1 text-xs text-[#a49fb0] transition hover:text-[#ff5d4a] disabled:opacity-50 ${FOCUS}`}
                        >
                          Sign out
                        </button>
                      )}
                    </div>
                  ))}
                  <FieldError>{devicesError}</FieldError>
                  <div className="pt-2">
                    {confirmAll ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-[#c9c4d2]">Sign out of every device, including this one?</span>
                        <button type="button" onClick={() => void signOutEverywhere()} className={`${BTN_GOLD} !py-1.5`}>
                          Yes, sign out everywhere
                        </button>
                        <button type="button" onClick={() => setConfirmAll(false)} className={BTN_GHOST}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setConfirmAll(true)} className={BTN_GHOST}>
                        Log out of all devices
                      </button>
                    )}
                  </div>
                </div>
              </Expand>
            </div>
            <Row label="Log out" hint="End your session on this device.">
              <button
                type="button"
                onClick={onLogout}
                className={`flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-[#c9c4d2] transition hover:border-[#ff5d4a]/40 hover:bg-[#ff5d4a]/5 hover:text-[#ff5d4a] ${FOCUS}`}
              >
                <LogOut size={15} /> Log out
              </button>
            </Row>
          </Section>
        </motion.div>

        {onOpenAdmin && me?.permissions.includes('users.read') && (
          <motion.div {...rise(4)}>
            <Section title="Admin">
              <Row label="Admin console" hint={`Signed in as ${me.role}. Manage accounts and review activity.`}>
                <button type="button" onClick={onOpenAdmin} className={BTN_GHOST}>
                  Open
                </button>
              </Row>
            </Section>
          </motion.div>
        )}

        <div className="flex items-center justify-center gap-2 pb-6 text-xs text-[#6f6a7c]">
            <Logo size={22} /> Infinite World
        </div>
      </main>

      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 rounded-full border border-[#e9b872]/40 bg-[#0d0b16]/95 px-4 py-2 text-sm text-[#eee9dc] shadow-[0_0_40px_rgba(233,184,114,0.12)] backdrop-blur-md"
            >
              <Check size={15} className="text-[#e9b872]" /> {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

