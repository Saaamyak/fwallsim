# Original soundtrack for the FWallSim launch video v2: 112 BPM, D minor (Dm-Bb-F-C),
# with effects tuned to the track and placed on the video's events (see video.html timings).
import wave
import numpy as np

SR = 48000
DUR = 22.9
N = int(SR * DUR)
rng = np.random.default_rng(11)

def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def lp(x, cutoff, passes=2):
    # cheap low-pass: repeated moving average
    w = max(1, int(SR / cutoff / 2))
    k = np.ones(w) / w
    for _ in range(passes):
        x = np.convolve(x, k, mode='same')
    return x

def add(buf, start, sig):
    s = int(start * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    buf[s:e] += sig[: e - s]

def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e

music = np.zeros(N)
fx = np.zeros(N)
send = np.zeros(N)  # reverb send

BEAT = 60 / 112
BAR = BEAT * 4
CHORDS = [[62, 65, 69], [58, 62, 65], [60, 65, 69], [60, 64, 67]]  # Dm Bb F/C C
BASS = [38, 34, 41, 36]
SCENES = [3.2, 6.6, 10.4, 14.2, 17.0, 20.2]
OUTRO = 20.3

# pad: detuned soft saws, low-passed, one chord per bar (quieter in the hook)
for bar in range(int(DUR / BAR) + 1):
    t0 = bar * BAR
    ch = CHORDS[bar % 4]
    n = int(BAR * 1.2 * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for m in ch:
        for d in (-0.08, 0.08):
            f = midi(m) * (1 + d / 100 * 12)
            sig += 2 * ((tt * f) % 1) - 1
    level = 0.022 if t0 < 3.0 else 0.032
    add(music, t0, lp(sig, 800) * env(n, 0.4, 0.7) * level)

# hook: a low D drone and a filtered noise riser into the reveal
n = int(3.3 * SR)
tt = np.arange(n) / SR
drone = (np.sin(2 * np.pi * midi(38) * tt) + 0.4 * np.sin(2 * np.pi * midi(50) * tt)) * env(n, 0.3, 0.4) * 0.07
add(music, 0.0, drone)
n = int(1.1 * SR)
riser = lp(rng.standard_normal(n), 2500, 2) * np.linspace(0, 1, n) ** 2.2 * 0.05
add(fx, 2.1, riser)

# bass from the reveal
for bar in range(int(DUR / BAR) + 1):
    for k in range(4):
        st = bar * BAR + k * BEAT
        if st < 3.2 or st > OUTRO:
            continue
        n = int(0.42 * SR)
        tt = np.arange(n) / SR
        f = midi(BASS[bar % 4])
        sig = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 5.5) * 0.15
        add(music, st, sig * env(n, 0.005, 0.05))

def kick():
    n = int(0.35 * SR)
    tt = np.arange(n) / SR
    f = 46 + 80 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9) * 0.34

def hat(level=0.04):
    n = int(0.06 * SR)
    x = rng.standard_normal(n)
    x = x - lp(x, 6000, 1)
    return x * np.exp(-np.arange(n) / SR * 70) * level

# kick from the reveal, hats from Build
b = 3.2
while b < OUTRO:
    add(music, b, kick())
    if b >= 6.6:
        add(music, b + BEAT / 2, hat())
    b += BEAT

def pluck(m, level=0.045, dec=6.0):
    n = int(0.6 * SR)
    tt = np.arange(n) / SR
    f = midi(m)
    s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.12 * np.sin(6 * np.pi * f * tt)
    return s * np.exp(-tt * dec) * env(n, 0.003, 0.05) * level

# plucked arpeggio from Build to the outro
st, i = 6.6, 0
while st < OUTRO - 0.1:
    ch = CHORDS[int(st // BAR) % 4]
    p = pluck([ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12][i % 4])
    add(music, st, p)
    add(send, st, p * 0.6)
    st += BEAT / 2
    i += 1

# ---------- effects (D minor pentatonic: D F G A C) ----------
def click(level=0.04):
    n = int(0.025 * SR)
    x = lp(rng.standard_normal(n), 3500, 1)
    return x * np.exp(-np.arange(n) / SR * 260) * level

def whoosh(length=0.45, level=0.04):
    n = int(length * SR)
    x = lp(rng.standard_normal(n), 1800, 2)
    return x * np.sin(np.linspace(0, np.pi, n)) ** 2 * level

def chime(m, level=0.06):
    n = int(1.2 * SR)
    tt = np.arange(n) / SR
    f = midi(m)
    s = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 2.01 * tt)
    return s * np.exp(-tt * 4.5) * env(n, 0.004, 0.1) * level

def thud(level=0.3):
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f = 52 * (1 + 0.7 * np.exp(-tt * 14))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4.5) * level

# hook: the Denied row lands; "Can you fix it?" rises (D-A)
add(fx, 0.88, thud(0.28))
add(fx, 0.88, click(0.05))
for k, m in enumerate((74, 81)):
    add(fx, 1.72 + k * 0.12, chime(m, 0.05))
    add(send, 1.72 + k * 0.12, chime(m, 0.04))
# scene changes
for s in SCENES:
    add(fx, s - 0.32, whoosh(0.45, 0.035))
# reveal: logo lands, Get started pulses
add(fx, 3.42, thud(0.18))
add(send, 3.42, chime(74, 0.04))
for s in (4.6, 5.4):
    add(fx, s, chime(86, 0.018))
# build: two clicks, then the green result
add(fx, 8.08, click(0.08)); add(fx, 8.1, chime(77, 0.025))
add(fx, 9.13, click(0.08)); add(fx, 9.15, chime(81, 0.025))
for k, m in enumerate((74, 81, 86)):
    add(fx, 9.58 + k * 0.07, chime(m, 0.035))
# packet walk: soft ticks per step, a chime on the policy step
for k in range(14):
    add(fx, 10.95 + k * 0.13, click(0.015))
add(fx, 12.9, chime(81, 0.05)); add(send, 12.9, chime(81, 0.035))
# CLI typing and the trace
for a, b2, cnt in ((14.6, 15.25, 39), (15.3, 15.8, 34), (15.85, 16.15, 21)):
    for k in range(0, cnt, 2):
        add(fx, a + (b2 - a) * k / cnt, click(0.02))
add(fx, 16.41, chime(77, 0.035))
# labs: pentatonic up per tick, then a chord on "Lab complete!"
for k, m in enumerate((74, 77, 79, 81)):
    add(fx, 17.6 + k * 0.28, chime(m + 12, 0.055))
    add(send, 17.6 + k * 0.28, chime(m + 12, 0.04))
for m in (62, 69, 74, 77):
    add(fx, 18.6, chime(m + 12, 0.028))
# outro: a warm hit and a held D minor chord
add(fx, OUTRO, thud(0.26))
n = int(2.6 * SR)
tt = np.arange(n) / SR
held = sum(np.sin(2 * np.pi * midi(m) * tt) for m in (50, 57, 62, 65, 69)) * np.exp(-tt * 0.9) * 0.042 * env(n, 0.02, 0.8)
add(music, OUTRO, held)
add(send, OUTRO, held * 0.5)

def reverb(x):
    y = np.zeros_like(x)
    for d, g in ((0.031, 0.5), (0.047, 0.45), (0.071, 0.4), (0.113, 0.35)):
        k = int(d * SR)
        z = np.copy(x)
        for _ in range(6):
            z = np.concatenate([np.zeros(k), z[:-k]]) * g
            y += z
    return lp(y, 4000, 1) * 0.5

# effects sit under the music and share its space
mix = music + fx * 0.8 + reverb(send + fx * 0.3 + music * 0.15)
fade = int(1.0 * SR)
mix[-fade:] *= np.linspace(1, 0, fade) ** 1.5
mix[: int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))
mix = np.tanh(mix * 1.5) / np.tanh(1.5)
mix = mix / np.max(np.abs(mix)) * 0.89
d = int(0.006 * SR)
right = np.concatenate([np.zeros(d), mix[:-d]]) * 0.25 + mix * 0.75
pcm = (np.stack([mix, right], axis=1) * 32767).astype(np.int16)
with wave.open('audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('audio.wav', DUR, 's')
