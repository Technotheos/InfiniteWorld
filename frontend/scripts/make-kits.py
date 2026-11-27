#!/usr/bin/env python3
"""Renders the Starship Studio drum kits to WAV files.

    python3 scripts/make-kits.py            # writes public/studio-kits/<kit>/<voice>.wav

Every sound is synthesised here from scratch (sines, noise, filters, saturation), so there is
nothing to license: the kits are royalty-free by construction. The files are ordinary mono
16-bit/44.1 kHz WAVs. To use recorded samples instead, drop CC0 WAVs over them with the same
file names; the app only cares about the names, not how the files were made.

Voices per kit: kick, snare, clap, hat, ohat, perc   (bass and lead stay synthesised live).
Needs numpy and scipy.
"""
import os
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'studio-kits')


def rng(seed):
    return np.random.default_rng(seed)


def tt(sec):
    return np.arange(int(sec * SR)) / SR


def pad(x, n):
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def decay(t, tau):
    return np.exp(-t / tau)


def sat(x, drive):
    return np.tanh(drive * x) / np.tanh(drive)


def filt(x, kind, freq, order=2):
    nyq = SR / 2
    if isinstance(freq, (list, tuple)):
        sos = signal.butter(order, [f / nyq for f in freq], btype=kind, output='sos')
    else:
        sos = signal.butter(order, freq / nyq, btype=kind, output='sos')
    return signal.sosfilt(sos, x)


def square(freq, length):
    """Square wave rendered at 4x the sample rate, then decimated, so it does not alias."""
    n = int(length * SR)
    t4 = np.arange(n * 4) / (SR * 4)
    return signal.resample_poly(np.sign(np.sin(2 * np.pi * freq * t4)), 1, 4)[:n]


def sweep(t, f0, f1, tau):
    """Sine whose pitch falls exponentially from f0 to f1 (time constant tau)."""
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def crush(x, bits=None, hold=1):
    if hold > 1:
        x = np.repeat(x[::hold], hold)[: len(x)]
    if bits:
        q = 2 ** (bits - 1)
        x = np.round(x * q) / q
    return x


def finish(x, peak=0.89):
    x = x - np.mean(x)
    x = filt(x, 'highpass', 25, 1)
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    n = min(int(0.08 * SR), len(x) // 3)  # smooth cosine tail so nothing ever clicks off
    x[-n:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, n)))
    return x


# ---- voices ------------------------------------------------------------------------------


def kick(p, seed):
    r = rng(seed)
    t = tt(p['len'])
    body = sweep(t, p['f0'], p['f1'], p['sweep']) * decay(t, p['tau'])
    body *= np.minimum(1, t / 0.0015)  # no click from the start of the wave
    click = filt(r.standard_normal(len(t)), 'bandpass', [900, 5000]) * decay(t, 0.0025) * p['click']
    sub = np.sin(2 * np.pi * p['f1'] * t) * decay(t, p['tau'] * 1.1) * p.get('sub', 0)
    return sat(body + click + sub, p['drive'])


def snare(p, seed):
    r = rng(seed)
    t = tt(p['len'])
    tone = (sweep(t, p['f0'] * 1.25, p['f0'], 0.012) * 0.7 + sweep(t, p['f0'] * 1.9, p['f0'] * 1.7, 0.02) * 0.3) * decay(t, p['tone_tau'])
    noise = filt(r.standard_normal(len(t)), 'bandpass', [p['n_lo'], p['n_hi']], 2)
    noise = noise * (decay(t, p['n_tau']) * 0.85 + 0.15 * decay(t, p['n_tau'] * 2))
    crack = filt(r.standard_normal(len(t)), 'bandpass', [3000, 8000]) * decay(t, 0.004) * 0.35
    return sat(tone * p['tone'] + noise * p['noise'] + crack, p['drive'])


def clap(p, seed):
    r = rng(seed)
    t = tt(p['len'])
    n = filt(r.standard_normal(len(t)), 'bandpass', [p['lo'], p['hi']], 2)
    env = np.zeros(len(t))
    for i in range(p['bursts']):
        t0 = i * p['gap']
        env += np.where(t >= t0, decay(np.maximum(t - t0, 0), 0.004), 0) * (0.75 if i < p['bursts'] - 1 else 1.0)
    tail = np.where(t >= p['bursts'] * p['gap'], decay(np.maximum(t - p['bursts'] * p['gap'], 0), p['tail']), 0) * 0.9
    return sat(n * (env * 0.8 + tail), 1.8)


RATIOS = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21]  # inharmonic partials: the classic metal-hat recipe


def hat(p, seed, open_=False):
    r = rng(seed)
    length = p['olen'] if open_ else p['len']
    t = tt(length)
    base = p['metal']
    sq = sum(square(base * k, length) for k in RATIOS) / len(RATIOS)
    sq = filt(sq, 'bandpass', [p['lo'], p.get('hi', 11000)], 2)
    nz = filt(filt(r.standard_normal(len(t)), 'highpass', p['lo'], 2), 'lowpass', p.get('hi', 11000), 2)
    tau = p['otau'] if open_ else p['tau']
    env = decay(t, tau) * np.minimum(1, t / 0.0008)
    if open_:
        env = env * 0.85 + 0.15 * decay(t, tau * 2.4)
    return (sq * p['mix'] + nz * (1 - p['mix'])) * env


def perc(p, seed):
    r = rng(seed)
    t = tt(p['len'])
    kind = p['kind']
    if kind == 'conga':
        x = sweep(t, p['f0'] * 1.15, p['f0'], 0.015) * decay(t, 0.12)
        x += 0.35 * np.sin(2 * np.pi * p['f0'] * 1.6 * t) * decay(t, 0.05)
        x += filt(r.standard_normal(len(t)), 'bandpass', [1500, 4000]) * decay(t, 0.003) * 0.5
    elif kind == 'cowbell':
        x = (square(562, p['len']) + square(845, p['len'])) * 0.5
        x = filt(x, 'bandpass', [500, 3500]) * (decay(t, 0.015) * 0.6 + decay(t, 0.12) * 0.4)
    elif kind == 'rim':
        x = sweep(t, 1900, 1650, 0.01) * decay(t, 0.02) + 0.5 * sweep(t, 480, 420, 0.02) * decay(t, 0.03)
        x += filt(r.standard_normal(len(t)), 'highpass', 2500) * decay(t, 0.0025) * 0.4
    else:  # shaker
        n = filt(r.standard_normal(len(t)), 'bandpass', [4500, 11000])
        env = np.minimum(1, t / 0.018) * decay(t, 0.05)
        x = n * env
    return sat(x, 1.4)


# ---- kits --------------------------------------------------------------------------------

KITS = {
    # Dusty, punchy, mid-forward drums for 80-100 BPM head-nodders.
    'boombap': dict(
        kick=dict(len=0.55, f0=170, f1=50, sweep=0.03, tau=0.13, click=0.35, drive=2.2, sub=0.25),
        snare=dict(len=0.4, f0=185, tone=0.8, tone_tau=0.07, noise=0.9, n_lo=1000, n_hi=6000, n_tau=0.06, drive=2.0),
        clap=dict(len=0.4, lo=1000, hi=3200, bursts=3, gap=0.011, tail=0.08),
        hat=dict(len=0.09, metal=210, lo=6000, hi=11000, mix=0.35, tau=0.018),
        ohat=dict(olen=0.45, metal=210, lo=5500, hi=11000, mix=0.35, otau=0.12),
        perc=dict(len=0.4, kind='conga', f0=330),
        post=None,
    ),
    # 808 low end, snappy snare, hard hats for 130-150 BPM trap.
    'trap': dict(
        kick=dict(len=1.3, f0=130, f1=46, sweep=0.022, tau=0.3, click=0.12, drive=3.0, sub=0.5),
        snare=dict(len=0.35, f0=230, tone=0.55, tone_tau=0.05, noise=1.0, n_lo=1500, n_hi=8000, n_tau=0.05, drive=2.4),
        clap=dict(len=0.55, lo=1200, hi=4200, bursts=4, gap=0.009, tail=0.12),
        hat=dict(len=0.06, metal=250, lo=7000, hi=12500, mix=0.5, tau=0.012),
        ohat=dict(olen=0.3, metal=250, lo=6500, hi=12500, mix=0.5, otau=0.08),
        perc=dict(len=0.3, kind='cowbell'),
        post=None,
    ),
    # Tight four-on-the-floor drums for 120-128 BPM house.
    'house': dict(
        kick=dict(len=0.45, f0=160, f1=52, sweep=0.02, tau=0.1, click=0.5, drive=2.6, sub=0.15),
        snare=dict(len=0.3, f0=200, tone=0.6, tone_tau=0.06, noise=1.0, n_lo=1300, n_hi=7000, n_tau=0.06, drive=2.2),
        clap=dict(len=0.45, lo=1100, hi=3600, bursts=4, gap=0.0095, tail=0.09),
        hat=dict(len=0.08, metal=230, lo=6500, hi=11500, mix=0.45, tau=0.02),
        ohat=dict(olen=0.4, metal=230, lo=6000, hi=11500, mix=0.45, otau=0.14),
        perc=dict(len=0.25, kind='shaker'),
        post=None,
    ),
    # Soft, crushed and dull. Everything is low-passed and bit-reduced for a tape feel.
    'lofi': dict(
        kick=dict(len=0.5, f0=140, f1=48, sweep=0.035, tau=0.14, click=0.12, drive=1.8, sub=0.3),
        snare=dict(len=0.4, f0=175, tone=0.9, tone_tau=0.09, noise=0.7, n_lo=800, n_hi=4500, n_tau=0.07, drive=1.8),
        clap=dict(len=0.4, lo=900, hi=2600, bursts=3, gap=0.013, tail=0.1),
        hat=dict(len=0.1, metal=200, lo=4000, hi=8000, mix=0.3, tau=0.022),
        ohat=dict(olen=0.4, metal=200, lo=3800, hi=8000, mix=0.3, otau=0.12),
        perc=dict(len=0.2, kind='rim'),
        post=dict(lp=6500, bits=11, hold=2),
    ),
}

VOICES = ['kick', 'snare', 'clap', 'hat', 'ohat', 'perc']


def render(kit_name, params):
    seed = sum(map(ord, kit_name))
    out = {}
    for i, v in enumerate(VOICES):
        s = seed * 31 + i
        if v == 'kick':
            x = kick(params['kick'], s)
        elif v == 'snare':
            x = snare(params['snare'], s)
        elif v == 'clap':
            x = clap(params['clap'], s)
        elif v == 'hat':
            x = hat(params['hat'], s)
        elif v == 'ohat':
            x = hat(params['ohat'], s, open_=True)
        else:
            x = perc(params['perc'], s)
        post = params.get('post')
        if post:
            x = filt(x, 'lowpass', post['lp'], 2)
            x = crush(x, post['bits'], post['hold'])
        # a little relative level so every voice sits well before the faders
        x = finish(x, peak={'kick': 0.95, 'snare': 0.9, 'clap': 0.85, 'hat': 0.7, 'ohat': 0.7, 'perc': 0.8}[v])
        out[v] = x
    return out


def write_wav(path, x):
    pcm = np.clip(x, -1, 1)
    pcm = (pcm * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    total = 0
    for name, params in KITS.items():
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        for v, x in render(name, params).items():
            p = os.path.join(d, f'{v}.wav')
            write_wav(p, x)
            total += os.path.getsize(p)
    print(f'wrote {len(KITS)} kits x {len(VOICES)} voices, {total / 1024:.0f} KB total -> {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
