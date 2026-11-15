import React, { useRef, useState } from 'react';
import { Lock, User } from 'lucide-react';
import { API_URL, readError, isNetworkError } from './authApi';
import { AuthShell, ErrorBanner, Field, LinkButton, SubmitButton } from './AuthShell';
import type { StarfieldHandle } from './Starfield';
import { setSession } from '../session';

interface LoginProps {
  onLoginSuccess: (token: string, username: string) => void;
  onSwitchToSignup: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, onSwitchToSignup }) => {
  const starfield = useRef<StarfieldHandle>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [warping, setWarping] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const body = new URLSearchParams({ username: username.trim(), password });

      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        // "include" lets the browser keep the HttpOnly refresh cookie the server sets.
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!response.ok) {
        throw new Error(await readError(response, 'Login failed. Please try again.'));
      }

      const data = await response.json();
      if (typeof data.token !== 'string' || typeof data.username !== 'string') {
        throw new Error('Unexpected response from the server.');
      }

      // Hyperspace jump into the app (capped so a stuck animation can never block login).
      setWarping(true);
      await Promise.race([
        starfield.current?.warp(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);

      // The token is kept in memory only (never localStorage). Setting it swaps
      // this screen for the app, so it happens after the animation.
      setSession(data.token, data.username, typeof data.expires_in === 'number' ? data.expires_in : 900);
      onLoginSuccess(data.token, data.username);
    } catch (err) {
      setWarping(false);
      if (isNetworkError(err)) {
        setError('Cannot reach the server. Check that it is running and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Operator Login"
      subtitle="Authenticate to access live trading & learning rooms"
      warping={warping}
      starfieldRef={starfield}
      footer={
        <>
          Don't have an operator account?{' '}
          <LinkButton onClick={onSwitchToSignup}>Sign Up</LinkButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="login-username"
          label="Username"
          icon={<User size={16} />}
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="trader_operator"
          value={username}
          onValueChange={setUsername}
        />

        <Field
          id="login-password"
          label="Password"
          icon={<Lock size={16} />}
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••••••"
          value={password}
          onValueChange={setPassword}
        />

        <SubmitButton loading={loading}>{loading ? 'Authenticating...' : 'Sign In'}</SubmitButton>
      </form>
    </AuthShell>
  );
};