import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Camera, Check, LogOut } from 'lucide-react';
import '../styles/celestial.css';
import { Starfield } from '../components/Starfield';
import { Sigil } from '../components/Sigil';
import { Avatar } from '../components/Avatar';
import { AvatarCropper } from '../components/AvatarCropper';
import { isNetworkError } from '../components/authApi';
import {
  AuthExpiredError, MAX_BIO, MIN_PASSWORD, USERNAME_RE, avatarUrl, changePassword, changeUsername,
  getMe, removeAvatar, saveBio, uploadAvatar, type Profile,
} from '../components/profileApi';
import { usePrefs, type Prefs } from '../hooks/usePrefs';
import { loadProgress, rankFor, totalXp } from '../game/chain-lab';

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
  /** Keeps the rest of the app (Home sidebar) in sync with edits made here. */
  onProfileChange: (patch: { bio?: string; avatarVersion?: number }) => void;
}

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';
const INPUT =
  'w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-[#eee9dc] placeholder:text-[#6f6a7c] transition-colors focus:border-[#e9b872]/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#e9b872]/50';
const BTN_GHOST = `rounded-xl border border-white/10 px-4 py-2 text-sm text-[#c9c4d2] transition hover:bg-white/5 hover:text-[#eee9dc] disabled:opacity-50 ${FOCUS}`;
const BTN_GOLD = `rounded-xl bg-[#e9b872] px-5 py-2 text-sm font-bold text-[#1a1208] transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 ${FOCUS}`;

const MAX_PICK_BYTES = 15 * 1024 * 1024;

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

/** Height-animated panel for the inline edit forms. */
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-[#ff5d4a]">
      {children}
    </p>
  );
}

const PREF_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'starfield', label: 'Starfield', hint: 'The moving stars behind every screen.' },
  { key: 'warp', label: 'Warp jump', hint: 'The hyperspace flash when you enter a room.' },
  { key: 'ambient', label: 'Ambient motion', hint: 'Drifting glow, turning rings and soft pulses.' },
];

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export default function Settings({ token, username, onBack, onLogout, onSessionChange, onProfileChange }: SettingsProps) {
  const reduce = useReducedMotion();
  const [prefs, setPref] = usePrefs();
  const [me, setMe] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState('');

  const [bio, setBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const [nameOpen, setNameOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [namePw, setNamePw] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const xp = totalXp(loadProgress());
  const rank = rankFor(xp);

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
        setBio(p.bio);
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

  /* ---- photo ---- */

  const pickFile = (file: File | undefined) => {
    setPhotoError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setPhotoError('That image is over 15 MB. Please choose a smaller one.');
      return;
    }
    setCropFile(file);
  };

  const savePhoto = async (jpeg: Blob) => {
    setUploading(true);
    try {
      const { avatar_version } = await uploadAvatar(token, jpeg);
      setMe((m) => (m ? { ...m, avatar_version } : m));
      onProfileChange({ avatarVersion: avatar_version });
      setCropFile(null);
      say('Photo updated');
    } catch (err) {
      setCropFile(null);
      setPhotoError(explain(err, 'Could not upload your picture.'));
    } finally {
      setUploading(false);
    }
  };

  const dropPhoto = async () => {
    setPhotoError('');
    setUploading(true);
    try {
      await removeAvatar(token);
      setMe((m) => (m ? { ...m, avatar_version: 0 } : m));
      onProfileChange({ avatarVersion: 0 });
      say('Photo removed');
    } catch (err) {
      setPhotoError(explain(err, 'Could not remove your picture.'));
    } finally {
      setUploading(false);
    }
  };

  /* ---- bio ---- */

  const bioDirty = me !== null && bio.trim() !== me.bio;
  const submitBio = async (e: FormEvent) => {
    e.preventDefault();
    if (!bioDirty || savingBio) return;
    setSavingBio(true);
    try {
      const res = await saveBio(token, bio.trim());
      setMe((m) => (m ? { ...m, bio: res.bio } : m));
      setBio(res.bio);
      onProfileChange({ bio: res.bio });
      say('Bio saved');
    } catch (err) {
      say(explain(err, 'Could not save your bio.'));
    } finally {
      setSavingBio(false);
    }
  };

  /* ---- username ---- */

  const cooldownUntil = me?.username_change_available_at ? new Date(me.username_change_available_at) : null;
  const onCooldown = cooldownUntil !== null && cooldownUntil.getTime() > Date.now();
  const nameFormatBad = newName.length > 0 && !USERNAME_RE.test(newName);

  const closeName = () => {
    setNameOpen(false);
    setNewName('');
    setNamePw('');
    setNameError('');
  };

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (savingName) return;
    const next = newName.trim().toLowerCase();
    if (!USERNAME_RE.test(next)) {
      setNameError("Use 3–32 characters: a–z, 0–9, '_', '.' or '-'.");
      return;
    }
    if (next === username) {
      setNameError('That is already your username.');
      return;
    }
    if (!namePw) {
      setNameError('Enter your password to confirm.');
      return;
    }
    setSavingName(true);
    setNameError('');
    try {
      const res = await changeUsername(token, next, namePw);
      onSessionChange(res.token, res.username, res.expires_in);
      closeName();
      await load(res.token);
      say('Username updated');
    } catch (err) {
      setNameError(explain(err, 'Could not change your username.'));
    } finally {
      setSavingName(false);
    }
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
      await changePassword(token, curPw, newPw);
      closePw();
      say('Password updated');
    } catch (err) {
      setPwError(explain(err, 'Could not change your password.'));
    } finally {
      setSavingPw(false);
    }
  };

  /* ---- render ---- */

  const src = me ? avatarUrl(username, me.avatar_version) : null;
  const hasPhoto = Boolean(src);
  const memberSince = me ? new Date(me.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const rise = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: i * 0.07 } };

  return (
    <div className={`iw-root relative min-h-screen overflow-hidden ${prefs.ambient ? '' : 'iw-calm'}`}>
      {prefs.starfield && <Starfield />}
      <div
        className="iw-anim pointer-events-none absolute left-[-10%] top-[-10%] z-0 h-[520px] w-[520px] rounded-full bg-[#2a1750]/30 blur-[150px]"
        style={{ animation: 'iw-drift 26s ease-in-out infinite' }}
      />
      <div
        className="iw-anim pointer-events-none absolute bottom-[-12%] right-[-10%] z-0 h-[620px] w-[620px] rounded-full bg-[#5a3b12]/20 blur-[170px]"
        style={{ animation: 'iw-drift 32s ease-in-out infinite reverse' }}
      />

      <main className="relative z-10 mx-auto max-w-2xl space-y-10 px-5 py-8 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-[#c9c4d2] backdrop-blur-md transition hover:bg-white/5 hover:text-[#eee9dc] ${FOCUS}`}
        >
          <ArrowLeft size={16} /> Home
        </button>

        {/* Identity */}
        <motion.header {...rise(0)} className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <div className="relative">
            <Sigil size={132}>
              <Avatar name={username} src={src} size={92} />
            </Sigil>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !me}
              aria-label={hasPhoto ? 'Change profile picture' : 'Add a profile picture'}
              className={`absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full border border-[#e9b872]/50 bg-[#0d0b16] text-[#e9b872] transition hover:bg-[#e9b872] hover:text-[#1a1208] disabled:opacity-50 ${FOCUS}`}
            >
              <Camera size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = ''; // lets the same file be picked again
              }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[#a49fb0]">
              {rank.title} · {xp} XP{memberSince ? ` · Member since ${memberSince}` : ''}
            </p>
            <h2 className="iw-display truncate text-5xl font-light capitalize leading-tight">{username}</h2>
            <div className="mt-2 flex items-center justify-center gap-3 sm:justify-start">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || !me} className={BTN_GHOST}>
                {hasPhoto ? 'Change photo' : 'Add photo'}
              </button>
              {hasPhoto && (
                <button
                  type="button"
                  onClick={() => void dropPhoto()}
                  disabled={uploading}
                  className={`rounded-lg px-2 py-1 text-sm text-[#a49fb0] transition hover:text-[#ff5d4a] disabled:opacity-50 ${FOCUS}`}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="mt-2 min-h-[1rem]">
              <FieldError>{photoError}</FieldError>
            </div>
          </div>
        </motion.header>

        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-[#ff5d4a]/30 bg-[#ff5d4a]/5 px-5 py-3 text-sm text-[#ff9b8f]">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load(token)} className={BTN_GHOST}>
              Retry
            </button>
          </div>
        )}

        {/* Profile */}
        <motion.div {...rise(1)}>
          <Section title="Profile" hint="What other explorers see next to your name.">
            <form onSubmit={submitBio}>
              <Row label="Bio" stack>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  maxLength={MAX_BIO}
                  disabled={!me}
                  placeholder="A line or two about you…"
                  aria-label="Bio"
                  className={`${INPUT} resize-none leading-relaxed`}
                />
                <div className="flex items-center justify-between">
                  <span className={`text-xs tabular-nums ${bio.length >= MAX_BIO ? 'text-[#e9b872]' : 'text-[#a49fb0]'}`}>
                    {bio.length} / {MAX_BIO}
                  </span>
                  <button type="submit" disabled={!bioDirty || savingBio} className={BTN_GOLD}>
                    {savingBio ? 'Saving…' : 'Save bio'}
                  </button>
                </div>
              </Row>
            </form>

            <div>
              <Row
                label="Username"
                hint={onCooldown && cooldownUntil ? `You can change it again on ${cooldownUntil.toLocaleString()}.` : 'You can change it once every 24 hours.'}
              >
                <div className="flex items-center gap-3">
                  <span className="max-w-[10rem] truncate text-sm text-[#c9c4d2]">@{username}</span>
                  <button
                    type="button"
                    onClick={() => (nameOpen ? closeName() : setNameOpen(true))}
                    disabled={!nameOpen && (onCooldown || !me)}
                    aria-expanded={nameOpen}
                    className={BTN_GHOST}
                  >
                    {nameOpen ? 'Cancel' : 'Change'}
                  </button>
                </div>
              </Row>
              <Expand open={nameOpen}>
                <form onSubmit={submitName} className="space-y-3 px-5 pb-5 sm:px-6">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#a49fb0]">@</span>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value.toLowerCase())}
                      placeholder="new-username"
                      aria-label="New username"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={32}
                      aria-invalid={nameFormatBad}
                      className={`${INPUT} pl-8`}
                    />
                  </div>
                  <input
                    type="password"
                    value={namePw}
                    onChange={(e) => setNamePw(e.target.value)}
                    placeholder="Current password"
                    aria-label="Current password"
                    autoComplete="current-password"
                    className={INPUT}
                  />
                  <p className={`text-xs ${nameFormatBad ? 'text-[#ff9b8f]' : 'text-[#a49fb0]'}`}>
                    3–32 characters: a–z, 0–9, “_”, “.” and “-”. You’ll stay signed in.
                  </p>
                  <FieldError>{nameError}</FieldError>
                  <div className="flex justify-end">
                    <button type="submit" disabled={savingName || !newName || !namePw} className={BTN_GOLD}>
                      {savingName ? 'Saving…' : 'Update username'}
                    </button>
                  </div>
                </form>
              </Expand>
            </div>
          </Section>
        </motion.div>

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

        <p className="pb-6 text-center text-xs text-[#6f6a7c]">Infinite World</p>
      </main>

      {cropFile && (
        <AvatarCropper file={cropFile} busy={uploading} onCancel={() => setCropFile(null)} onDone={(b) => void savePhoto(b)} />
      )}

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

