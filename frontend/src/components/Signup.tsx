import React, { useState } from 'react';
import { Lock, Mail, User } from 'lucide-react';
import { API_URL, readError, isNetworkError } from './authApi';
import { AuthShell, ErrorBanner, Field, LinkButton, SubmitButton } from './AuthShell';

interface SignupProps {
  onSignupSuccess: () => void;
  onSwitchToLogin: () => void;
}

// These mirror the server rules in auth.go so users get instant feedback.
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 12;
const MAX_PASSWORD_BYTES = 72; // bcrypt limit

// Cosmetic only: the server enforces length, not these extra tiers.
const STRENGTH_LABELS = ['', 'Fair', 'Good', 'Strong', 'Stellar'];
const STRENGTH_COLORS = ['', 'bg-amber-400', 'bg-sky-400', 'bg-indigo-400', 'bg-emerald-400'];

function passwordStrength(pw: string): number {
  if (pw.length < MIN_PASSWORD) return 0;
  let score = 1;
  if (pw.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 3) score++;
  if (pw.length >= 20) score++;
  return score;
}

const PasswordHint: React.FC<{ password: string }> = ({ password }) => {
  const len = password.length;
  const score = passwordStrength(password);

  let text = `At least ${MIN_PASSWORD} characters. A passphrase works well.`;
  let tone = 'text-slate-500';
  if (len > 0 && score === 0) {
    text = `${len}/${MIN_PASSWORD} characters`;
    tone = 'text-amber-400';
  } else if (score > 0) {
    text = `${STRENGTH_LABELS[score]} · ${len} characters`;
    tone = 'text-slate-400';
  }

  return (
    <>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-500 ${
              i <= score ? STRENGTH_COLORS[score] : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      <p className={`mt-1.5 text-[11px] ${tone}`}>{text}</p>
    </>
  );
};

export const Signup: React.FC<SignupProps> = ({ onSignupSuccess, onSwitchToLogin }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): string | null => {
    if (!USERNAME_RE.test(username.trim())) {
      return 'Username must be 3-32 characters: letters, numbers, "_", "." or "-".';
    }
    if (password.length < MIN_PASSWORD) {
      return `Password must be at least ${MIN_PASSWORD} characters.`;
    }
    if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      return `Password is too long (max ${MAX_PASSWORD_BYTES} bytes).`;
    }
    return null;
  };

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      const body = new URLSearchParams({
        username: username.trim(),
        email: email.trim(),
        password,
      });

      const response = await fetch(`${API_URL}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to create account.'));
      }

      // Safely consume the JSON response body returned by the Go server
      try {
        await response.json();
      } catch {
        // Ignored if empty
      }

      onSignupSuccess();
    } catch (err) {
      if (isNetworkError(err)) {
        setError('Cannot reach the server. Check that it is running and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create Account"
      subtitle="Register your operator ID for persistent room access"
      footer={
        <>
          Already have an account? <LinkButton onClick={onSwitchToLogin}>Sign In</LinkButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="signup-username"
          label="Username"
          icon={<User size={16} />}
          type="text"
          required
          minLength={3}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="trader_operator"
          value={username}
          onValueChange={setUsername}
          hint={<p className="text-[11px] text-slate-500">3-32 characters: letters, numbers, _ . -</p>}
        />

        <Field
          id="signup-email"
          label="Email"
          icon={<Mail size={16} />}
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="operator@domain.com"
          value={email}
          onValueChange={setEmail}
        />

        <Field
          id="signup-password"
          label="Password"
          icon={<Lock size={16} />}
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          placeholder="••••••••••••"
          value={password}
          onValueChange={setPassword}
          hint={<PasswordHint password={password} />}
        />

        <SubmitButton loading={loading}>{loading ? 'Creating Account...' : 'Sign Up'}</SubmitButton>
      </form>
    </AuthShell>
  );
};