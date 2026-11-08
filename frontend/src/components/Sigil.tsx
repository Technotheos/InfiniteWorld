/** Small rotating star sigil used next to the player's callsign. */
export function Sigil({ size = 80 }: { size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="absolute inset-0 iw-spin">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(233,184,114,0.45)" strokeWidth="1" strokeDasharray="2 5" />
        <circle cx="50" cy="4" r="3" fill="#e9b872" />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(238,233,220,0.22)" />
        <path d="M50 22 L55 45 L78 50 L55 55 L50 78 L45 55 L22 50 L45 45 Z" fill="rgba(233,184,114,0.92)" />
      </svg>
    </div>
  );
}
