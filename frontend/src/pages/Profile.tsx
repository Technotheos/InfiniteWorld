import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Camera, Check, Flame, Pencil, Settings as SettingsIcon } from 'lucide-react';
import '../styles/celestial.css';
import { Starfield } from '../components/Starfield';
import { Sigil } from '../components/Sigil';
import { Avatar } from '../components/Avatar';
import { AvatarCropper } from '../components/AvatarCropper';
import { isNetworkError } from '../components/authApi';
import { BTN_GHOST, BTN_GOLD, Expand, FOCUS, FieldError, INPUT } from '../components/formKit';
import {
  AuthExpiredError, MAX_BIO, USERNAME_RE, avatarUrl, changeUsername, getMe, removeAvatar, saveBio, uploadAvatar,
  type Profile as MyProfile,
} from '../components/profileApi';
import { usePrefs } from '../hooks/usePrefs';
import { rankFor } from '../game/chain-lab/progress';
import { getCard, type PeopleKind, type UserCard } from '../social/socialApi';
import { PeopleList } from '../social/PeopleList';

/* -------------------------------------------------------------------------- */
/*  Your profile: the same XP card other players see, but you can edit it.    */
/*  Everything else (sound, privacy, password...) lives behind the gear.      */
/* -------------------------------------------------------------------------- */

interface ProfileProps {
  token: string;
  username: string;
  onBack: () => void;
  onOpenSettings: () => void;
  /** The session is gone: the app should sign the user out. */
  onAuthExpired: () => void;
  /** The server issued a new token (after a username change). */
  onSessionChange: (token: string, username: string, expiresIn: number) => void;
  /** Keeps the Home sidebar picture in sync. */
  onAvatarChange: (version: number) => void;
}

const MAX_PICK_BYTES = 15 * 1024 * 1024;

const BADGE_LABELS: Record<string, string> = {
  'streak-3': '3-day streak',
  'streak-7': '7-day streak',
  'streak-30': '30-day streak',
};

function Stat({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${n} ${label}. Show the list`}
      className={`flex-1 px-2 py-3 text-center transition hover:bg-white/5 focus-visible:bg-white/5 ${FOCUS}`}
    >
      <div className="text-xl font-semibold tabular-nums text-[#eee9dc]">{n}</div>
      <div className="text-[11px] uppercase tracking-wider text-[#a49fb0]">{label}</div>
    </button>
  );
}

export default function Profile({ token, username, onBack, onOpenSettings, onAuthExpired, onSessionChange, onAvatarChange }: ProfileProps) {
  const reduce = useReducedMotion();
  const [prefs] = usePrefs();
  const [card, setCard] = useState<UserCard | null>(null);
  const [me, setMe] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState('');

  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [bioError, setBioError] = useState('');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const [nameOpen, setNameOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [namePw, setNamePw] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [list, setList] = useState<PeopleKind | null>(null);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Turns a failed request into a message, or signs out when the session is gone. */
  const explain = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof AuthExpiredError) {
        onAuthExpired();
        return '';
      }
      if (isNetworkError(err)) return 'Cannot reach the server. Check your connection and try again.';
      return err instanceof Error && err.message ? err.message : fallback;
    },
    [onAuthExpired],
  );

  const load = useCallback(
    async (tok: string, name: string) => {
      try {
        // The card is what others see (server XP, counts); `me` adds the username cooldown.
        const [c, p] = await Promise.all([getCard(tok, name), getMe(tok)]);
        setCard(c);
        setMe(p);
        setLoadError('');
      } catch (err) {
        setLoadError(explain(err, 'Could not load your profile.'));
      }
    },
    [explain],
  );

  useEffect(() => {
    void load(token, username);
    // Load once on open; later edits update the card directly.
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
      setCard((c) => (c ? { ...c, avatar_version } : c));
      onAvatarChange(avatar_version);
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
      setCard((c) => (c ? { ...c, avatar_version: 0 } : c));
      onAvatarChange(0);
      say('Photo removed');
    } catch (err) {
      setPhotoError(explain(err, 'Could not remove your picture.'));
    } finally {
      setUploading(false);
    }
  };

  /* ---- bio ---- */

  const startBio = () => {
    setBioDraft(card?.bio ?? '');
    setBioError('');
    setEditingBio(true);
  };

  const submitBio = async (e: FormEvent) => {
    e.preventDefault();
    if (!card || savingBio) return;
    const next = bioDraft.trim();
    if (next === card.bio) {
      setEditingBio(false);
      return;
    }
    setSavingBio(true);
    setBioError('');
    try {
      const res = await saveBio(token, next);
      setCard((c) => (c ? { ...c, bio: res.bio } : c));
      setEditingBio(false);
      say('Bio saved');
    } catch (err) {
      setBioError(explain(err, 'Could not save your bio.'));
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
      await load(res.token, res.username);
      say('Username updated');
    } catch (err) {
      setNameError(explain(err, 'Could not change your username.'));
    } finally {
      setSavingName(false);
    }
  };

  /* ---- render ---- */

  const rank = card ? rankFor(card.xp) : null;
  const src = card ? avatarUrl(username, card.avatar_version) : null;
  const memberSince = card ? new Date(card.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
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

      <main className="relative z-10 mx-auto max-w-xl space-y-6 px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className={`flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-[#c9c4d2] backdrop-blur-md transition hover:bg-white/5 hover:text-[#eee9dc] ${FOCUS}`}
          >
            <ArrowLeft size={16} /> Home
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            className={`grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-[#c9c4d2] backdrop-blur-md transition hover:bg-white/5 hover:text-[#e9b872] ${FOCUS}`}
          >
            <SettingsIcon size={18} />
          </button>
        </div>

        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-[#ff5d4a]/30 bg-[#ff5d4a]/5 px-5 py-3 text-sm text-[#ff9b8f]">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load(token, username)} className={BTN_GHOST}>
              Retry
            </button>
          </div>
        )}

        {!card && !loadError && (
          <div className="grid place-items-center py-24" aria-busy="true" aria-label="Loading your profile">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#e9b872]/30 border-t-[#e9b872]" />
          </div>
        )}

        {card && rank && (
          <motion.section
            {...rise(0)}
            aria-label="Your profile"
            className="rounded-3xl border border-white/10 bg-[#0d0b16]/80 p-6 text-[#eee9dc] shadow-[0_0_60px_rgba(233,184,114,0.06)] backdrop-blur-md sm:p-8"
          >
            {/* Picture */}
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <Sigil size={132}>
                  <Avatar name={username} src={src} size={92} />
                </Sigil>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label={src ? 'Change profile picture' : 'Add a profile picture'}
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
              {src && (
                <button
                  type="button"
                  onClick={() => void dropPhoto()}
                  disabled={uploading}
                  className={`mt-1 rounded-lg px-2 py-1 text-xs text-[#a49fb0] transition hover:text-[#ff5d4a] disabled:opacity-50 ${FOCUS}`}
                >
                  Remove photo
                </button>
              )}
              <div className="min-h-[1rem]">
                <FieldError>{photoError}</FieldError>
              </div>

              {/* Name */}
              <div className="mt-2 flex max-w-full items-center justify-center gap-2">
                <h1 className="iw-display truncate text-4xl font-light capitalize leading-tight sm:text-5xl">{username}</h1>
                <button
                  type="button"
                  onClick={() => (nameOpen ? closeName() : setNameOpen(true))}
                  disabled={!nameOpen && onCooldown}
                  aria-expanded={nameOpen}
                  aria-label="Change username"
                  title={
                    onCooldown && cooldownUntil
                      ? `You can change it again on ${cooldownUntil.toLocaleString()}`
                      : 'Change username'
                  }
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#a49fb0] transition hover:bg-white/10 hover:text-[#e9b872] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#a49fb0] ${FOCUS}`}
                >
                  <Pencil size={15} />
                </button>
              </div>
            </div>

            <div className="mx-auto max-w-sm">
              <Expand open={nameOpen}>
                <form onSubmit={submitName} className="space-y-3 pt-4">
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
                    3–32 characters: a–z, 0–9, “_”, “.” and “-”. You can change it once every 24 hours, and you’ll stay signed in.
                  </p>
                  <FieldError>{nameError}</FieldError>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={closeName} className={BTN_GHOST}>
                      Cancel
                    </button>
                    <button type="submit" disabled={savingName || !newName || !namePw} className={BTN_GOLD}>
                      {savingName ? 'Saving…' : 'Update username'}
                    </button>
                  </div>
                </form>
              </Expand>
            </div>

            {/* Rank + XP */}
            <div className="mt-3 flex flex-col items-center text-center">
              <div className="text-sm text-[#e9b872]">{rank.title}</div>
              <div className="text-xs text-[#a49fb0] tabular-nums">
                {card.xp} XP{rank.next ? ` · ${rank.next.at - card.xp} to ${rank.next.title}` : ''}
              </div>
              <div
                className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={Math.round(rank.pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress to next rank"
              >
                <div className="h-full bg-gradient-to-r from-[#e9b872] to-[#9b8cff]" style={{ width: `${Math.round(rank.pct)}%` }} />
              </div>
              {memberSince && <div className="mt-2 text-xs text-[#a49fb0]">Member since {memberSince}</div>}
            </div>

            {/* Streak + badges */}
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <Flame size={16} className={card.streak > 0 ? 'text-[#ff9f4a]' : 'text-white/25'} />
              <span className={card.streak > 0 ? 'text-[#eee9dc]' : 'text-[#a49fb0]'}>
                {card.streak > 0 ? `${card.streak}-day streak` : 'No streak yet'}
              </span>
            </div>
            {card.badges.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {card.badges.map((b) => (
                  <span key={b} className="rounded-full border border-[#e9b872]/30 bg-[#e9b872]/10 px-2.5 py-0.5 text-xs text-[#e9b872]">
                    {BADGE_LABELS[b] ?? b}
                  </span>
                ))}
              </div>
            )}

            {/* Bio */}
            <div className="mt-6">
              {editingBio ? (
                <form onSubmit={submitBio} className="space-y-2">
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    rows={3}
                    maxLength={MAX_BIO}
                    autoFocus
                    placeholder="A line or two about you…"
                    aria-label="Bio"
                    className={`${INPUT} resize-none leading-relaxed`}
                  />
                  <FieldError>{bioError}</FieldError>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-xs tabular-nums ${bioDraft.length >= MAX_BIO ? 'text-[#e9b872]' : 'text-[#a49fb0]'}`}>
                      {bioDraft.length} / {MAX_BIO}
                    </span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditingBio(false)} disabled={savingBio} className={BTN_GHOST}>
                        Cancel
                      </button>
                      <button type="submit" disabled={savingBio} className={BTN_GOLD}>
                        {savingBio ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-center gap-2">
                  {card.bio ? (
                    <p className="min-w-0 whitespace-pre-line break-words text-center text-sm text-[#c9c4d2]">{card.bio}</p>
                  ) : (
                    <button type="button" onClick={startBio} className={`rounded-lg px-2 py-1 text-sm italic text-[#a49fb0] hover:text-[#eee9dc] ${FOCUS}`}>
                      Add a bio…
                    </button>
                  )}
                  {card.bio && (
                    <button
                      type="button"
                      onClick={startBio}
                      aria-label="Edit bio"
                      title="Edit bio"
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#a49fb0] transition hover:bg-white/10 hover:text-[#e9b872] ${FOCUS}`}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Counts: tap for the lists */}
            <div className="mt-6 flex divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <Stat n={card.followers} label="Followers" onClick={() => setList('followers')} />
              <Stat n={card.following} label="Following" onClick={() => setList('following')} />
              <Stat n={card.friends} label="Friends" onClick={() => setList('friends')} />
            </div>
            <p className="mt-3 text-center text-xs text-[#6f6a7c]">
              This is how other players see you. Only your friends can open your lists.
            </p>
          </motion.section>
        )}
      </main>

      {list && <PeopleList owner={username} kind={list} onClose={() => setList(null)} />}

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
