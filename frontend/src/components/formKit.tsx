import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/** Small pieces shared by the Profile and Settings pages. */

export const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';
export const INPUT =
  'w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-[#eee9dc] placeholder:text-[#6f6a7c] transition-colors focus:border-[#e9b872]/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#e9b872]/50';
export const BTN_GHOST = `rounded-xl border border-white/10 px-4 py-2 text-sm text-[#c9c4d2] transition hover:bg-white/5 hover:text-[#eee9dc] disabled:opacity-50 ${FOCUS}`;
export const BTN_GOLD = `rounded-xl bg-[#e9b872] px-5 py-2 text-sm font-bold text-[#1a1208] transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 ${FOCUS}`;

/** Height-animated panel for inline edit forms. */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
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

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-[#ff5d4a]">
      {children}
    </p>
  );
}
