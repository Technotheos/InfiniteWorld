import { useEffect, useState } from 'react';
import { publicAvatarUrl } from './profileApi';

interface AvatarProps {
  name: string;
  /** Picture URL, or null/undefined for the initial-letter fallback. */
  src?: string | null;
  size?: number;
  className?: string;
}

/** Round profile picture, with the Home sidebar's gold-and-violet initial as fallback. */
export function Avatar({ name, src, size = 40, className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const showImage = Boolean(src) && !failed;
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full border border-[#e9b872]/40 bg-gradient-to-br from-[#e9b872]/25 to-[#9b8cff]/25 grid place-items-center font-bold text-[#e9b872] ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={src!} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{(name || '?').charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}


/** Avatar for any user: loads their public profile picture by username. */
export function UserAvatar({ name, size = 40, className = '' }: { name: string; size?: number; className?: string }) {
  return <Avatar name={name} src={name ? publicAvatarUrl(name) : null} size={size} className={className} />;
}
