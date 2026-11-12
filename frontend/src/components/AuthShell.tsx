import { Logo } from './Logo';
import React, { useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Starfield, prefersReducedMotion, type StarfieldHandle } from './Starfield';

/* -------------------------------------------------------------------------- */
/*  AuthShell: starfield + nebula + tilting glass card, shared by Login/Signup */
/* -------------------------------------------------------------------------- */

interface AuthShellProps {
  title: string;
  subtitle: string;
  /** True while the hyperspace jump plays (fades the card, flashes the screen). */
  warping?: boolean;
  starfieldRef?: React.Ref<StarfieldHandle>;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AuthShell: React.FC<AuthShellProps> = ({
  title,
  subtitle,
  warping = false,
  starfieldRef,
  children,
  footer,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Cursor spotlight + subtle 3D tilt. Uses refs/CSS vars, so no re-renders.
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    if (!prefersReducedMotion()) {
      const px = x / r.width - 0.5;
      const py = y / r.height - 0.5;
      el.style.transform = `perspective(1000px) rotateY(${px * 4}deg) rotateX(${-py * 4}deg)`;
    }
  };

  const handleLeave = () => {
    if (cardRef.current) cardRef.current.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
  };

  return (
    <main className="relative min-h-screen bg-black text-slate-100 flex items-center justify-center p-4 overflow-hidden">
      <style>{`
        @keyframes lb-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        @keyframes lb-drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,30px); } }
        @keyframes lb-orbit { to { transform: rotate(360deg); } }
        @keyframes lb-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
        @media (prefers-reduced-motion: reduce) { .lb-anim { animation: none !important; } }
      `}</style>

      <Starfield ref={starfieldRef} />

      {/* Nebula glows */}
      <div
        className="lb-anim absolute top-[-15%] left-[-10%] w-[520px] h-[520px] bg-indigo-950/30 rounded-full blur-[150px] pointer-events-none z-0"
        style={{ animation: 'lb-drift 26s ease-in-out infinite' }}
      />
      <div
        className="lb-anim absolute bottom-[-15%] right-[-10%] w-[620px] h-[620px] bg-sky-950/25 rounded-full blur-[170px] pointer-events-none z-0"
        style={{ animation: 'lb-drift 32s ease-in-out infinite reverse' }}
      />

      {/* Warp flash */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-700 ${
          warping ? 'opacity-20' : 'opacity-0'
        }`}
      />

      {/* Entrance + warp fade live on the wrapper; tilt lives on the card */}
      <div
        className={`relative z-10 w-full max-w-md transition-all duration-700 ${
          warping ? 'opacity-0 scale-110' : 'opacity-100'
        }`}
        style={{ animation: 'lb-rise .8s ease backwards' }}
      >
        <div
          ref={cardRef}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/60 backdrop-blur-xl p-8 shadow-[0_0_60px_rgba(56,189,248,0.08)]"
          style={{ transition: 'transform .25s ease-out', transform: 'perspective(1000px)' }}
        >
          {/* spotlight following the cursor */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(380px circle at var(--mx, 50%) var(--my, 0%), rgba(56,189,248,0.10), transparent 45%)',
            }}
          />
          {/* glowing top edge */}
          <div
            aria-hidden="true"
            className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/70 to-transparent"
          />

          <div className="relative">
            {/* Logo with an orbiting satellite */}
            <div className="flex items-center gap-3 mb-6">
              <Logo size={46} animated />
              <span className="text-lg font-bold tracking-wider text-[#e9b872]">InfiniteWorld</span>
            </div>

            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
              <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
            </div>

            {children}

            {footer && <div className="mt-6 text-center text-sm text-slate-400">{footer}</div>}
          </div>
        </div>
      </div>
    </main>
  );
};

/* -------------------------------------------------------------------------- */
/*  Form pieces                                                                */
/* -------------------------------------------------------------------------- */

export const ErrorBanner: React.FC<{ message: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="lb-anim mb-4 p-3 bg-red-950/40 border border-red-500/30 text-red-200 text-sm rounded-xl backdrop-blur-md"
      style={{ animation: 'lb-shake .4s ease' }}
    >
      {message}
    </div>
  );
};

interface FieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id'> {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  hint?: React.ReactNode;
}

/** Input with leading icon, focus glow, and (for type="password") a show/hide toggle. */
export const Field: React.FC<FieldProps> = ({
  id,
  label,
  icon,
  value,
  onValueChange,
  hint,
  type = 'text',
  ...rest
}) => {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1.5">
        {label}
      </label>
      <div className="relative group">
        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 transition-colors group-focus-within:text-sky-400">
          {icon}
        </span>
        <input
          id={id}
          type={isPassword && show ? 'text' : type}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={`w-full bg-white/[0.03] border border-white/10 rounded-xl py-2.5 pl-10 ${
            isPassword ? 'pr-10' : 'pr-4'
          } text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-all focus:border-sky-400/60 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(56,189,248,0.12)]`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <div className="mt-1.5">{hint}</div>}
    </div>
  );
};

export const SubmitButton: React.FC<{ loading: boolean; children: React.ReactNode }> = ({
  loading,
  children,
}) => (
  <button
    type="submit"
    disabled={loading}
    className="group relative w-full mt-2 overflow-hidden rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 border border-sky-400/30 transition-all hover:brightness-110 hover:shadow-sky-400/40 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
  >
    {/* light sweep on hover */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
    />
    <span className="relative">{children}</span>
    {loading ? (
      <Loader2 size={16} className="relative animate-spin" />
    ) : (
      <ArrowRight size={16} className="relative transition-transform group-hover:translate-x-0.5" />
    )}
  </button>
);

export const LinkButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="text-sky-400 hover:text-sky-300 hover:underline font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300 rounded"
  >
    {children}
  </button>
);