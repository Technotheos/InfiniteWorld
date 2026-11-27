import { CHANNELS, filterHz, TRACKS, type MusicState } from './audio';
import type { StudioSend } from './studioApi';
import { DELAY_DIVS, delaySeconds, MELODIC_TRACKS } from './theory';

interface Props {
  music: MusicState;
  bpm: number;
  canEdit: boolean;
  send: StudioSend;
}

const channelName = (c: number) => (c < TRACKS.length ? TRACKS[c]!.label : MELODIC_TRACKS[c - TRACKS.length]!.label);

/** Space: the shared reverb and tempo-synced delay, the filter sweep, and a send for every track. */
export function SpacePanel({ music, bpm, canEdit, send }: Props) {
  return (
    <section className="sp-panel sp-space" aria-label="Space: reverb, delay and filter">
      <header className="sp-panel-h">
        <h2>Space</h2>
        <span className="sp-sub">One shared reverb and echo. Each track sends into them. This is what makes a piano loop sound huge.</span>
      </header>
      <div className="sp-tools">
        <label className="sp-vol">
          Filter {music.filter >= 100 ? 'open' : `${Math.round(filterHz(music.filter))} Hz`}
          <input type="range" min={0} max={100} value={music.filter} disabled={!canEdit} onChange={(e) => send('fx', { filter: Number(e.target.value) })} aria-label="Master filter sweep. All the way right is open." />
        </label>
        <label className="sp-field">
          Echo time
          <select className="sp-kit sp-wide" value={music.dlyDiv} disabled={!canEdit} onChange={(e) => send('fx', { div: e.target.value })} aria-label="Delay time, synced to the tempo">
            {DELAY_DIVS.map((d) => (
              <option key={d.id} value={d.id}>{d.label} · {Math.round(delaySeconds(d.id, bpm) * 1000)} ms</option>
            ))}
          </select>
        </label>
        <label className="sp-vol">
          Echo repeats {music.dlyFB}%
          <input type="range" min={0} max={90} value={music.dlyFB} disabled={!canEdit} onChange={(e) => send('fx', { fb: Number(e.target.value) })} aria-label="Delay feedback" />
        </label>
      </div>
      <details className="sp-sends">
        <summary>Sends for every track</summary>
        <table className="sp-sendtable">
          <thead>
            <tr><th scope="col">Track</th><th scope="col">Reverb</th><th scope="col">Delay</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: CHANNELS }, (_, c) => (
              <tr key={c}>
                <th scope="row">{channelName(c)}</th>
                <td><input type="range" className="sp-fader" min={0} max={100} value={music.send[c]?.[0] ?? 0} disabled={!canEdit} onChange={(e) => send('send', { c, rev: Number(e.target.value) })} aria-label={`${channelName(c)} reverb send`} /></td>
                <td><input type="range" className="sp-fader" min={0} max={100} value={music.send[c]?.[1] ?? 0} disabled={!canEdit} onChange={(e) => send('send', { c, dly: Number(e.target.value) })} aria-label={`${channelName(c)} delay send`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
