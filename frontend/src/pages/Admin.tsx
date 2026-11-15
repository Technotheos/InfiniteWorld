import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Search } from 'lucide-react';
import '../styles/celestial.css';
import { Starfield } from '../components/Starfield';
import { usePrefs } from '../hooks/usePrefs';
import { ApiError, AuthExpiredError, getMe, type Profile } from '../components/profileApi';
import {
  disableUser, enableUser, listAudit, listUsers, revokeUserSessions, setRole,
  type AdminUser, type AuditEvent, type Role,
} from '../components/adminApi';

interface AdminProps {
  token: string;
  username: string;
  onBack: () => void;
  onAuthExpired: () => void;
}

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';
const INPUT =
  'w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-[#eee9dc] placeholder:text-[#6f6a7c] transition-colors focus:border-[#e9b872]/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#e9b872]/50';
const BTN = `rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#c9c4d2] transition hover:bg-white/5 hover:text-[#eee9dc] disabled:opacity-50 ${FOCUS}`;
const BTN_DANGER = `rounded-lg border border-[#ff5d4a]/30 px-3 py-1.5 text-xs text-[#ff9b8f] transition hover:bg-[#ff5d4a]/10 disabled:opacity-50 ${FOCUS}`;

const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

const FILTERS: { label: string; prefix: string }[] = [
  { label: 'All', prefix: '' },
  { label: 'Sign-ins', prefix: 'auth.' },
  { label: 'Admin', prefix: 'admin.' },
  { label: 'Profile', prefix: 'profile.' },
];

const ACTION_LABELS: Record<string, string> = {
  'auth.signup': 'Account created',
  'auth.login': 'Sign-in',
  'auth.login_locked': 'Sign-in blocked (too many attempts)',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out everywhere',
  'auth.session_revoked': 'Device signed out',
  'auth.refresh_reuse': 'Stolen session detected',
  'auth.password_change': 'Password changed',
  'auth.reauth_failed': 'Wrong password confirmation',
  'profile.username_change': 'Username changed',
  'admin.role_set': 'Role changed',
  'admin.user_disable': 'Account disabled',
  'admin.user_enable': 'Account enabled',
  'admin.sessions_revoked': 'Sessions revoked',
  'admin.denied': 'Admin action denied',
  'admin.ip_denied': 'Admin access blocked (network)',
  'admin.cli_promote': 'Promoted to admin (console)',
  'admin.cli_demote': 'Admin removed (console)',
};

function RoleBadge({ role }: { role: Role }) {
  if (role === 'user') return null;
  const tone = role === 'admin' ? 'border-[#9b8cff]/50 text-[#b9adff]' : 'border-[#e9b872]/50 text-[#e9b872]';
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>{role}</span>;
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function describeDetail(d?: Record<string, unknown>): string {
  if (!d) return '';
  return Object.entries(d)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function Admin({ token, username, onBack, onAuthExpired }: AdminProps) {
  const reduce = useReducedMotion();
  const [prefs] = usePrefs();
  const [me, setMe] = useState<Profile | null>(null);
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [error, setError] = useState('');

  // users
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [next, setNext] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [busy, setBusy] = useState('');
  const [disabling, setDisabling] = useState('');
  const [reason, setReason] = useState('');

  // audit
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditNext, setAuditNext] = useState(0);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const say = (m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AuthExpiredError) return onAuthExpired();
      if (err instanceof ApiError && err.status === 404)
        return setError("Admin tools aren't available from this network. Ask the server owner to add your address to ADMIN_ALLOWED_CIDRS.");
      if (err instanceof ApiError && err.status === 403) return setError(err.message || "You don't have permission to do that.");
      setError(err instanceof TypeError ? 'Cannot reach the server.' : err instanceof Error ? err.message : 'Something went wrong.');
    },
    [onAuthExpired],
  );

  const perms = me?.permissions ?? [];
  const can = (p: string) => perms.includes(p);
  const myRank = me ? RANK[me.role] : 0;
  const manageable = (u: AdminUser) => u.username !== username && myRank > RANK[u.role];

  useEffect(() => {
    getMe(token).then(setMe).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUsers = useCallback(
    async (reset: boolean, after = '') => {
      setLoadingUsers(true);
      setError('');
      try {
        const res = await listUsers(token, q.trim().toLowerCase(), after);
        setUsers((prev) => (reset ? res.users : [...prev, ...res.users]));
        setNext(res.next);
      } catch (err) {
        fail(err);
      } finally {
        setLoadingUsers(false);
      }
    },
    [token, q, fail],
  );

  // Debounced search / first load.
  useEffect(() => {
    if (!me || !can('users.read')) return;
    const t = window.setTimeout(() => void loadUsers(true), q ? 300 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, me]);

  const loadAudit = useCallback(
    async (reset: boolean, before = 0) => {
      setLoadingAudit(true);
      setError('');
      try {
        const res = await listAudit(token, filter, before);
        setEvents((prev) => (reset ? res.events : [...prev, ...res.events]));
        setAuditNext(res.next);
      } catch (err) {
        fail(err);
      } finally {
        setLoadingAudit(false);
      }
    },
    [token, filter, fail],
  );

  useEffect(() => {
    if (tab === 'audit' && me && can('audit.read')) void loadAudit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter, me]);

  const act = async (u: AdminUser, label: string, fn: () => Promise<unknown>) => {
    setBusy(u.username);
    setError('');
    try {
      await fn();
      say(`${label}: ${u.username}`);
      await loadUsers(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  };

  const rise = reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 } };

  return (
    <div className={`iw-root relative min-h-screen overflow-hidden ${prefs.ambient ? '' : 'iw-calm'}`}>
      {prefs.starfield && <Starfield />}
      <main className="relative z-10 mx-auto max-w-3xl space-y-8 px-5 py-8 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-[#c9c4d2] backdrop-blur-md transition hover:bg-white/5 hover:text-[#eee9dc] ${FOCUS}`}
        >
          <ArrowLeft size={16} /> Settings
        </button>

        <motion.header {...rise}>
          <p className="text-xs text-[#a49fb0]">{me ? `Signed in as ${me.role}` : ' '}</p>
          <h1 className="iw-display text-5xl font-light leading-tight">Admin console</h1>
        </motion.header>

        {me && !can('users.read') && (
          <p role="alert" className="rounded-2xl border border-white/10 bg-[#0d0b16]/75 px-5 py-4 text-sm text-[#c9c4d2]">
            You don't have access to this area.
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border border-[#ff5d4a]/30 bg-[#ff5d4a]/5 px-5 py-3 text-sm text-[#ff9b8f]">
            {error}
          </div>
        )}

        {me && can('users.read') && (
          <>
            <div role="tablist" className="flex gap-2">
              {(['users', ...(can('audit.read') ? ['audit'] : [])] as ('users' | 'audit')[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`rounded-xl border px-4 py-2 text-sm transition ${FOCUS} ${
                    tab === t ? 'border-[#e9b872]/60 bg-[#e9b872]/10 text-[#e9b872]' : 'border-white/10 text-[#a49fb0] hover:text-[#eee9dc]'
                  }`}
                >
                  {t === 'users' ? 'Users' : 'Audit log'}
                </button>
              ))}
            </div>

            {tab === 'users' && (
              <motion.section {...rise} className="space-y-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#a49fb0]" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value.toLowerCase())}
                    placeholder="Search by username…"
                    aria-label="Search users"
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${INPUT} pl-10`}
                  />
                </div>

                <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md">
                  {users.length === 0 && !loadingUsers && <p className="px-6 py-6 text-sm text-[#a49fb0]">No users found.</p>}
                  {users.map((u) => {
                    const mine = u.username === username;
                    const ok = manageable(u);
                    return (
                      <div key={u.username} className="space-y-3 px-5 py-4 sm:px-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-[#eee9dc]">@{u.username}</span>
                              {mine && <span className="text-[10px] uppercase tracking-wider text-[#a49fb0]">you</span>}
                              <RoleBadge role={u.role} />
                              {u.disabled && (
                                <span className="rounded-full border border-[#ff5d4a]/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#ff9b8f]">
                                  disabled
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-[#a49fb0]">
                              {u.sessions} active {u.sessions === 1 ? 'session' : 'sessions'} · joined {when(u.created_at)}
                            </div>
                            {u.disabled && u.disabled_reason && <div className="mt-0.5 text-xs text-[#ff9b8f]">Reason: {u.disabled_reason}</div>}
                          </div>

                          {ok && (
                            <div className="flex flex-wrap items-center gap-2">
                              {can('users.role.set') && (
                                <select
                                  aria-label={`Role for ${u.username}`}
                                  value={u.role}
                                  disabled={busy === u.username}
                                  onChange={(e) => void act(u, 'Role updated', () => setRole(token, u.username, e.target.value as Role))}
                                  className={`rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-[#c9c4d2] ${FOCUS}`}
                                >
                                  <option value="user">user</option>
                                  <option value="moderator">moderator</option>
                                </select>
                              )}
                              {can('sessions.revoke') && (
                                <button
                                  type="button"
                                  className={BTN}
                                  disabled={busy === u.username || u.sessions === 0}
                                  onClick={() => void act(u, 'Signed out everywhere', () => revokeUserSessions(token, u.username))}
                                >
                                  Sign out
                                </button>
                              )}
                              {can('users.disable') &&
                                (u.disabled ? (
                                  <button type="button" className={BTN} disabled={busy === u.username} onClick={() => void act(u, 'Enabled', () => enableUser(token, u.username))}>
                                    Enable
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={BTN_DANGER}
                                    disabled={busy === u.username}
                                    onClick={() => {
                                      setDisabling(disabling === u.username ? '' : u.username);
                                      setReason('');
                                    }}
                                  >
                                    Disable
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>

                        {disabling === u.username && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const r = reason;
                              setDisabling('');
                              void act(u, 'Disabled', () => disableUser(token, u.username, r));
                            }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={200}
                              placeholder="Reason (optional, shown in the audit log)"
                              aria-label="Reason for disabling"
                              autoFocus
                              className={`${INPUT} flex-1`}
                            />
                            <button type="submit" className={BTN_DANGER}>
                              Confirm disable
                            </button>
                            <button type="button" className={BTN} onClick={() => setDisabling('')}>
                              Cancel
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>

                {next && (
                  <div className="text-center">
                    <button type="button" className={BTN} disabled={loadingUsers} onClick={() => void loadUsers(false, next)}>
                      {loadingUsers ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </motion.section>
            )}

            {tab === 'audit' && (
              <motion.section {...rise} className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      onClick={() => setFilter(f.prefix)}
                      aria-pressed={filter === f.prefix}
                      className={`rounded-full border px-3 py-1 text-xs transition ${FOCUS} ${
                        filter === f.prefix ? 'border-[#e9b872]/60 text-[#e9b872]' : 'border-white/10 text-[#a49fb0] hover:text-[#eee9dc]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md">
                  {events.length === 0 && !loadingAudit && <p className="px-6 py-6 text-sm text-[#a49fb0]">Nothing recorded yet.</p>}
                  {events.map((e) => (
                    <div key={e.id} className="flex gap-3 px-5 py-3.5 sm:px-6">
                      <span
                        aria-label={e.success ? 'succeeded' : 'failed'}
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.success ? 'bg-[#5eead4]' : 'bg-[#ff5d4a]'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[#eee9dc]">{ACTION_LABELS[e.action] ?? e.action}</div>
                        <div className="truncate text-xs text-[#a49fb0]">
                          {e.actor ? `@${e.actor}` : 'anonymous'}
                          {e.target && e.target !== e.actor ? ` → @${e.target}` : ''}
                          {e.ip ? ` · ${e.ip}` : ''} · {when(e.at)}
                        </div>
                        {describeDetail(e.detail) && <div className="mt-0.5 truncate text-xs text-[#6f6a7c]">{describeDetail(e.detail)}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {auditNext > 0 && (
                  <div className="text-center">
                    <button type="button" className={BTN} disabled={loadingAudit} onClick={() => void loadAudit(false, auditNext)}>
                      {loadingAudit ? 'Loading…' : 'Load older'}
                    </button>
                  </div>
                )}
              </motion.section>
            )}
          </>
        )}
      </main>

      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
        {toast && (
          <div className="rounded-full border border-[#e9b872]/40 bg-[#0d0b16]/95 px-4 py-2 text-sm text-[#eee9dc] backdrop-blur-md">{toast}</div>
        )}
      </div>
    </div>
  );
}
