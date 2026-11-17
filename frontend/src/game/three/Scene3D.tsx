import { useEffect, useRef } from "react";
import type { SceneHandle } from "./common";

interface Props<S> {
  /** Lazily loads the scene factory, so three.js is only downloaded when a 3D room is opened. */
  load: () => Promise<(host: HTMLElement) => SceneHandle<S> | null>;
  state: S;
  className?: string;
  label: string;
}

/** Mounts a 3D scene in a div and feeds it the latest state. If WebGL is missing it simply stays empty. */
export function Scene3D<S>({ load, state, className, label }: Props<S>) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle<S> | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    let dead = false;
    let h: SceneHandle<S> | null = null;
    load()
      .then((create) => {
        if (dead || !host.current) return;
        try {
          h = create(host.current);
        } catch {
          h = null;
        }
        handle.current = h;
        h?.update(latest.current);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      h?.dispose();
      handle.current = null;
    };
  }, [load]);

  useEffect(() => {
    handle.current?.update(state);
  });

  return <div ref={host} className={className} role="img" aria-label={label} />;
}
