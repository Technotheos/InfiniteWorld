import { apiRequest } from './profileApi';

export type Role = 'user' | 'moderator' | 'admin';

export interface AdminUser {
  username: string;
  role: Role;
  created_at: string;
  disabled: boolean;
  disabled_reason?: string;
  sessions: number;
}

export interface AuditEvent {
  id: number;
  at: string;
  actor: string;
  action: string;
  target?: string;
  success: boolean;
  ip?: string;
  user_agent?: string;
  detail?: Record<string, unknown>;
}

const post = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

export const listUsers = (token: string, q: string, after = '') => {
  const qs = new URLSearchParams({ limit: '25' });
  if (q) qs.set('q', q);
  if (after) qs.set('after', after);
  return apiRequest<{ users: AdminUser[]; next: string }>(`/api/admin/users?${qs}`, token, { method: 'GET' }, 'Could not load users.');
};

export const setRole = (token: string, username: string, role: Role) =>
  apiRequest<{ role: Role }>('/api/admin/users/role', token, post({ username, role }), 'Could not change that role.');

export const disableUser = (token: string, username: string, reason: string) =>
  apiRequest<{ disabled: boolean }>('/api/admin/users/disable', token, post({ username, reason }), 'Could not disable that account.');

export const enableUser = (token: string, username: string) =>
  apiRequest<{ disabled: boolean }>('/api/admin/users/enable', token, post({ username }), 'Could not enable that account.');

export const revokeUserSessions = (token: string, username: string) =>
  apiRequest<{ ok: boolean }>('/api/admin/users/revoke', token, post({ username }), 'Could not sign that user out.');

export const listAudit = (token: string, action: string, before = 0) => {
  const qs = new URLSearchParams({ limit: '30' });
  if (action) qs.set('action', action);
  if (before) qs.set('before', String(before));
  return apiRequest<{ events: AuditEvent[]; next: number }>(`/api/admin/audit?${qs}`, token, { method: 'GET' }, 'Could not load the audit log.');
};
