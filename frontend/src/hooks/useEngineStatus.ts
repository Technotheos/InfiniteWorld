import { useEffect, useState } from 'react';
import { API_URL } from '../components/authApi';

export type EngineStatus = 'connected' | 'connecting' | 'offline';

/**
 * Pings the Go server's public /api/maps endpoint so the Home badge reflects
 * whether the backend is actually reachable.
 */
export function useEngineStatus(enabled: boolean, intervalMs = 30_000): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const ping = async () => {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(`${API_URL}/api/maps`, { signal: ctrl.signal });
        if (!cancelled) setStatus(res.ok ? 'connected' : 'offline');
      } catch {
        if (!cancelled) setStatus('offline');
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void ping();
    const timer = window.setInterval(ping, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return status;
}
