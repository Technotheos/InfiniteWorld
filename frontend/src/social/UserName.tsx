import type { ReactNode } from 'react';
import { useSocialOptional } from './socialCore';

/** A username that opens the profile card when tapped (plain text outside the provider). */
export function UserName({ name, className = '', children }: { name: string; className?: string; children?: ReactNode }) {
  const social = useSocialOptional();
  if (!social) return <span className={className}>{children ?? name}</span>;
  return (
    <button
      type="button"
      onClick={() => social.openCard(name)}
      className={`iw-name-btn ${className}`}
      title={`View ${name}'s profile`}
    >
      {children ?? name}
    </button>
  );
}
