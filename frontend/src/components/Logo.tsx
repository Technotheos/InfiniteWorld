import { useId } from 'react';

/** The infinity path: also used to guide the orbiting dot. */
const LOOP = 'M50 50 C62 32 86 32 86 50 C86 68 62 68 50 50 C38 32 14 32 14 50 C14 68 38 68 50 50 Z';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface LogoProps {
  size?: number;
  /** Let the small dot travel around the loop. Respects "reduce motion". */
  animated?: boolean;
  className?: string;
}

/** Infinite World mark: one gold infinity loop and a pale orbiting dot. */
export function Logo({ size = 40, animated = false, className = '' }: LogoProps) {
  const id = useId().replace(/:/g, '');
  const move = animated && !reducedMotion();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="Infinite World">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3cf94" />
          <stop offset="1" stopColor="#e9b872" />
        </linearGradient>
      </defs>
      <path d={LOOP} fill="none" stroke={`url(#${id}g)`} strokeWidth="4.5" strokeLinejoin="round" />
      {move ? (
        <circle r="5" fill="#eee9dc">
          <animateMotion dur="9s" repeatCount="indefinite" path={LOOP} />
        </circle>
      ) : (
        <circle cx="72.5" cy="36.5" r="5" fill="#eee9dc" />
      )}
    </svg>
  );
}