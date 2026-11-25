import { useEffect, useMemo, useRef, useState } from 'react';
import { UserAvatar } from '../components/Avatar';
import { useSocialOptional } from '../social/SocialContext';
import { studioInvites, type Invite } from './studioApi';
import './studio.css';

const TAGLINE = 'Build the beat. Bring the voice.';
const BPM = 90;

interface Props {
  /** Open the studio, optionally straight into a private session you were invited to. */
  onEnter: (code?: string) => void;
  disabled?: boolean;
  /** The app's reduced-motion / ambient preference: when false the ring is a still picture. */
  animate: boolean;
  /** The app's starfield preference. */
  starfield: boolean;
}

const gold = '#e9b872';
const violet = '#9b8cff';

/**
 * The doorway on Home. A dark glass card with a ring of light that is a live waveform bending into
 * a pulsar. Idle it breathes at 90 BPM with a faint kick in its starfield; hover or focus speeds it up,
 * blooms an equalizer and types the tagline in.
 */
export function StudioDoorway({ onEnter, disabled, animate, starfield }: Props) {
  const social = useSocialOptional();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hot = useRef(false);
  const [active, setActive] = useState(false);
  const [typed, setTyped] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);

  const onAir = social?.counts.studio ?? 0;
  const inside = useMemo(() => (social?.friends ?? []).filter((f) => f.online && f.room?.map === 'studio'), [social?.friends]);
  const sealed = inside.some((f) => f.room?.name === 'Private session');
  const invite = invites[0];
  const shown = inside.slice(0, 5);

  // Invites are the only thing that needs asking the server; poll gently and only while visible.
  useEffect(() => {
    let live = true;
    const load = () => document.visibilityState === 'visible' && studioInvites().then((i) => live && setInvites(i)).catch(() => undefined);
    void load();
    const id = window.setInterval(load, 8000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    hot.current = active;
    if (!active) {
      setTyped('');
      return;
    }
    if (!animate) {
      setTyped(TAGLINE);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(TAGLINE.slice(0, i));
      if (i >= TAGLINE.length) window.clearInterval(id);
    }, 32);
    return () => window.clearInterval(id);
  }, [active, animate]);

  // The ring. One canvas: stars, kick glow, waveform ring, pulsar beams.
  useEffect(() => {
    const cv = canvas.current;
    const host = box.current;
    if (!cv || !host) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const stars = Array.from({ length: 46 }, (_, i) => ({ x: ((i * 7919) % 997) / 997, y: ((i * 104729) % 991) / 991, s: 0.4 + ((i * 31) % 10) / 10, p: i }));
    let w = 0;
    let h = 0;
    let raf = 0;
    let speed = 1;
    let rot = 0;
    let phase = 0;
    let last = performance.now();
    let t0 = last;

    const size = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number, still: boolean) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const beat = still ? 0.12 : t * (BPM / 60);
      const kick = still ? 0.25 : Math.exp(-(beat % 1) * 6);
      const hover = hot.current ? 1 : 0;
      speed += ((hover ? 3.2 : 1) - speed) * Math.min(1, dt * 4);
      rot += dt * 0.18 * speed;
      phase += dt * 2.2 * speed;
      g.clearRect(0, 0, w, h);

      if (starfield) {
        for (const s of stars) {
          const a = 0.18 + 0.25 * s.s * (0.6 + 0.4 * Math.sin(t * 0.8 + s.p)) + kick * 0.3;
          g.fillStyle = `rgba(238,233,220,${Math.min(0.8, a)})`;
          g.fillRect(s.x * w, s.y * h, s.s * 1.4, s.s * 1.4);
        }
      }
      const cx = w * 0.5;
      const cy = h * 0.46;
      const R = Math.min(w, h) * 0.3 * (1 + 0.03 * kick);
      const halo = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.2);
      halo.addColorStop(0, `rgba(155,140,255,${0.1 + 0.14 * kick})`);
      halo.addColorStop(1, 'rgba(155,140,255,0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, w, h);

      const N = 200;
      const amp = R * (0.05 + 0.07 * kick + 0.1 * hover * speed * 0.3);
      const beam = R * (0.16 + 0.5 * (speed - 1) / 2.2);
      const grad = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      grad.addColorStop(0, gold);
      grad.addColorStop(1, violet);
      g.lineWidth = 2.2;
      g.strokeStyle = grad;
      g.shadowColor = hover ? violet : gold;
      g.shadowBlur = 10 + 14 * kick;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2 + rot;
        const wave = Math.sin(th * 5 + phase) * 0.55 + Math.sin(th * 11 - phase * 1.3) * 0.3 + Math.sin(th * 2 + phase * 0.5) * 0.4;
        // pulsar: two narrow beams on opposite sides of the ring
        const d1 = Math.atan2(Math.sin(th - rot * 1.4), Math.cos(th - rot * 1.4));
        const d2 = Math.atan2(Math.sin(th - rot * 1.4 - Math.PI), Math.cos(th - rot * 1.4 - Math.PI));
        const spike = Math.exp(-(d1 * d1) / 0.006) + Math.exp(-(d2 * d2) / 0.006);
        const r = R + wave * amp + spike * beam;
        const x = cx + Math.cos(th) * r;
        const y = cy + Math.sin(th) * r * 0.96;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
      g.shadowBlur = 0;
    };

    size();
    const ro = new ResizeObserver(() => {
      size();
      if (!animate) draw(performance.now(), true);
    });
    ro.observe(host);
    if (!animate) {
      draw(performance.now(), true); // a still picture: same ring, no motion
    } else {
      const loop = (now: number) => {
        draw(now, false);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [animate, starfield]);

  const label = `Open Starship Studio. ${onAir > 0 ? `${onAir} ${onAir === 1 ? 'producer' : 'producers'} on air.` : 'The studio is open.'}`;

  return (
    <div
      className={`spd${active ? ' hot' : ''}${animate ? ' anim' : ''}`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setActive(false)}
    >
      <div className="spd-canvas" ref={box} aria-hidden="true">
        <canvas ref={canvas} />
      </div>

      <button type="button" className="spd-hit" disabled={disabled} aria-label={label} onClick={() => onEnter()} />

      <div className="spd-badge" role="status">
        <i aria-hidden="true" />
        {onAir > 0 ? `${onAir} ${onAir === 1 ? 'producer' : 'producers'} on air` : 'Studio open'}
      </div>

      {shown.length > 0 && (
        <div className="spd-orbit" aria-label="Friends in the studio">
          {shown.map((f, i) => (
            <span key={f.name} className="spd-moon" style={{ ['--a' as string]: `${(360 / shown.length) * i}deg` }}>
              <span className="spd-moon-in">
                <UserAvatar name={f.name} size={28} />
              </span>
            </span>
          ))}
        </div>
      )}

      {(sealed || invite) && (
        <div className={`spd-iris${invite ? ' open' : ''}`}>
          <svg viewBox="0 0 40 40" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <path key={i} className="blade" style={{ ['--i' as string]: i }} d="M20 20 L20 3 A17 17 0 0 1 32 8 Z" />
            ))}
          </svg>
          {invite ? (
            <button type="button" className="spd-iris-btn" onClick={() => onEnter(invite.code)}>
              {invite.from} invited you
            </button>
          ) : (
            <span className="spd-iris-t">Private session</span>
          )}
        </div>
      )}

      <div className="spd-eq" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i, ['--h' as string]: 0.35 + ((i * 37) % 10) / 16 }} />
        ))}
      </div>

      <div className="spd-copy">
        <div className="spd-kicker">// STARSHIP STUDIO</div>
        <h3>Starship Studio</h3>
        <p className="spd-tag" aria-hidden="true">{typed || '\u00a0'}</p>
        <p className="sr-only">{TAGLINE}</p>
      </div>
    </div>
  );
}
