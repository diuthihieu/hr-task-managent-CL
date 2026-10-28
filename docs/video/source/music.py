"""Original soundtrack + SFX + voice-over mix for the woli mobile launch video (all synthesized, no samples)."""
import json, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

V = sys.argv[1]
SR = 48000
BPM = 128
BEAT = 60 / BPM
BAR = 4 * BEAT
TOTAL = 52.5
N = int(TOTAL * SR)
rng = np.random.default_rng(7)


def t_of(n):
    return np.arange(n) / SR


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def saw(freq, n, harmonics_cap=9000):
    t = t_of(n)
    out = np.zeros(n)
    k = 1
    while freq * k < harmonics_cap and k < 40:
        out += np.sin(2 * np.pi * freq * k * t) / k
        k += 1
    return out * (2 / np.pi)


def supersaw(freq, n, voices=5, detune=0.012):
    out = np.zeros(n)
    for i in range(voices):
        d = 1 + detune * (i - (voices - 1) / 2) / ((voices - 1) / 2)
        out += np.roll(saw(freq * d, n), int(rng.integers(0, 2000)))
    return out / voices


def env_adsr(n, a, d, s, r):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na)
    e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
    if nr:
        e[-nr:] *= np.linspace(1, 0, min(nr, n))
    return e


def add(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    p, o = name[:-1], int(name[-1])
    return 440 * 2 ** ((names[p] + 12 * (o + 1) - 69) / 12)


# Uplifting progression: F - G - Am - C (one chord per bar)
CHORDS = [["F3", "A3", "C4", "E4"], ["G3", "B3", "D4", "G4"], ["A3", "C4", "E4", "A4"], ["C4", "E4", "G4", "C5"]]
ROOTS = ["F1", "G1", "A1", "C2"]

# Section boundaries (seconds)
INTRO_END = 6 * BAR  # 11.25
DROP = 8 * BAR  # 15.0
GUIDE = (11 * BAR, 17 * BAR)  # install guide: softer drop
OUTRO = 24 * BAR  # 45.0

music = np.zeros(N)
sfx = np.zeros(N)

# ---------- pad (whole track) ----------
pad = np.zeros(N)
nbars = int(np.ceil(TOTAL / BAR))
for b in range(nbars):
    ch = CHORDS[b % 4]
    n = int(BAR * SR * 1.15)
    sig = sum(supersaw(note(x), n, voices=4, detune=0.008) for x in ch) / len(ch)
    sig *= env_adsr(n, 0.5, 0.3, 0.85, 0.5)
    add(pad, sig, b * BAR)
pad = lp(pad, 2400)
t = t_of(N)
pad_gain = np.interp(t, [0, 2, INTRO_END, DROP - 0.3, DROP, OUTRO, TOTAL - 2, TOTAL], [0, 0.32, 0.36, 0.42, 0.22, 0.22, 0.3, 0])
music += pad * pad_gain

# ---------- piano-like plucks in the intro (inspirational motif) ----------
motif = ["A4", "C5", "E5", "C5", "G4", "B4", "D5", "B4"]
for b in range(6):
    for i in range(8):
        f = note(CHORDS[b % 4][i % 4].replace("3", "5").replace("4", "5"))
        n = int(0.6 * SR)
        tt = t_of(n)
        sig = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.12 * np.sin(6 * np.pi * f * tt)) * np.exp(-tt * 6)
        add(music, sig * 0.11 * (0.6 + 0.4 * (b / 6)), b * BAR + i * BEAT / 2)

# ---------- drums ----------
def kick():
    n = int(0.45 * SR)
    tt = t_of(n)
    f = 45 + 110 * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-tt * 7.5)) * 0.9


def clap():
    n = int(0.25 * SR)
    noise = bp(rng.standard_normal(n), 900, 5000)
    tt = t_of(n)
    e = np.exp(-tt * 22) + 0.6 * np.exp(-np.maximum(tt - 0.012, 0) * 30) * (tt > 0.012)
    return noise * e * 0.45


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    tt = t_of(n)
    return hp(rng.standard_normal(n), 7000) * np.exp(-tt * (14 if open_ else 70)) * (0.22 if open_ else 0.16)


K, C, HO, HC = kick(), clap(), hat(True), hat(False)
side = np.ones(N)  # sidechain envelope from kicks


def place_kick(at, g=1.0):
    add(music, K * g, at)
    i = int(at * SR)
    n = int(0.28 * SR)
    j = min(N, i + n)
    side[i:j] = np.minimum(side[i:j], 1 - 0.75 * np.exp(-t_of(j - i) * 9))


# heartbeat kick in the intro (from bar 2), building
for b in range(2, 6):
    place_kick(b * BAR, 0.55)
    place_kick(b * BAR + 2 * BEAT, 0.4)
# build: 4-on-floor + snare roll accelerating (bars 6-7)
for i in range(8):
    place_kick(INTRO_END + i * BEAT, 0.6 + 0.04 * i)
roll_t = INTRO_END
step = BEAT
while roll_t < DROP - 0.25:
    prog = (roll_t - INTRO_END) / (DROP - INTRO_END)
    add(music, C * (0.25 + 0.6 * prog), roll_t)
    step = BEAT if prog < 0.5 else (BEAT / 2 if prog < 0.75 else BEAT / 4)
    roll_t += step
# drop section groove
b = DROP
while b < OUTRO - 0.01:
    soft = GUIDE[0] <= b < GUIDE[1]
    for i in range(4):
        place_kick(b + i * BEAT, 0.85 if soft else 1.0)
        add(music, HO * (0.6 if soft else 1.0), b + i * BEAT + BEAT / 2)
        for s in range(4):
            if s % 2:
                add(music, HC * (0.5 if soft else 0.9), b + i * BEAT + s * BEAT / 4)
    add(music, C * (0.6 if soft else 1.0), b + BEAT)
    add(music, C * (0.6 if soft else 1.0), b + 3 * BEAT)
    b += BAR

# ---------- bass (offbeat 8ths from the drop) ----------
bass = np.zeros(N)
b = DROP
bar_i = 0
while b < OUTRO + BAR:
    f = note(ROOTS[bar_i % 4])
    for i in range(8):
        if i % 2 == 1:
            n = int(BEAT / 2 * SR)
            tt = t_of(n)
            sig = (saw(f * 2, n, 2500) * 0.6 + np.sin(2 * np.pi * f * tt)) * env_adsr(n, 0.005, 0.05, 0.8, 0.03)
            add(bass, sig, b + i * BEAT / 2)
    b += BAR
    bar_i += 1
bass = lp(bass, 900) * 0.42
bass_gain = np.interp(t, [0, DROP - 0.01, DROP, OUTRO + BAR, OUTRO + BAR + 0.5, TOTAL], [0, 0, 1, 1, 0, 0])
music += bass * bass_gain

# ---------- arpeggio pluck (energy) ----------
arp = np.zeros(N)
b = DROP
bar_i = 0
while b < OUTRO:
    ch = CHORDS[bar_i % 4]
    pattern = [0, 1, 2, 3, 2, 1, 2, 3] * 2
    for i, idx in enumerate(pattern):
        f = note(ch[idx]) * 2
        n = int(0.2 * SR)
        tt = t_of(n)
        sig = saw(f, n, 8000) * np.exp(-tt * 18)
        add(arp, sig, b + i * BEAT / 4)
    b += BAR
    bar_i += 1
arp = lp(hp(arp, 300), 6000)
arp_gain = np.interp(t, [0, DROP, DROP + 0.01, GUIDE[0], GUIDE[0] + 0.01, GUIDE[1], GUIDE[1] + 0.01, OUTRO, OUTRO + 0.01, TOTAL], [0, 0, 0.16, 0.16, 0.07, 0.07, 0.17, 0.17, 0, 0])
music += arp * arp_gain

# sidechain pump on pad/arp/bass after the drop
pump = np.where(t >= DROP, side, 1.0)
music *= 0.55 + 0.45 * pump

# ---------- SFX ----------
def riser(dur):
    n = int(dur * SR)
    tt = t_of(n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    seg = int(0.05 * SR)
    for i in range(0, n, seg):
        c = 400 + 9000 * (i / n) ** 2
        out[i:i + seg] = bp(noise[i:i + seg + 2000], c * 0.7, min(c * 1.3, 20000))[: len(out[i:i + seg])]
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1600 * (tt / dur) ** 2) / SR) * 0.15
    return (out * 0.35 + sweep) * (tt / dur) ** 1.6


def impact():
    n = int(2.2 * SR)
    tt = t_of(n)
    boom = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-tt * 6)) / SR) * np.exp(-tt * 2.2)
    crash = hp(rng.standard_normal(n), 3000) * np.exp(-tt * 3) * 0.25
    return np.tanh((boom * 1.2 + crash) * 1.3) * 0.75


def whoosh(dur=0.45):
    n = int(dur * SR)
    tt = t_of(n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    seg = int(0.02 * SR)
    for i in range(0, n, seg):
        x = i / n
        c = 500 + 5000 * np.sin(np.pi * x)
        out[i:i + seg] = bp(noise[i:i + seg + 800], c * 0.6, c * 1.4)[: len(out[i:i + seg])]
    return out * np.sin(np.pi * tt / dur) ** 2 * 0.32


def tap():
    n = int(0.05 * SR)
    tt = t_of(n)
    return (np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt * 120)) * 0.25


add(sfx, riser(DROP - INTRO_END), INTRO_END)
add(sfx, impact(), DROP)
add(sfx, impact() * 0.8, OUTRO)
add(sfx, impact() * 0.35, 3.75)
add(sfx, impact() * 0.35, 7.5)
cuts = json.load(open(f"{V}/timeline.json"))["cuts"]
for c in cuts:
    add(sfx, whoosh(), c - 0.22)
for tp in json.load(open(f"{V}/timeline.json"))["taps"]:
    add(sfx, tap(), tp)

# ---------- voice-over ----------
vo = np.zeros(N)
meta = {m["key"]: m for m in json.load(open(f"{V}/vo/meta.json"))}
for key, at in json.load(open(f"{V}/timeline.json"))["vo"].items():
    x, sr = sf.read(f"{V}/vo/{key}.wav")
    if sr != SR:
        idx = np.arange(0, len(x), sr / SR)
        x = np.interp(idx, np.arange(len(x)), x)
    add(vo, x, at)
# voice: high-pass, gentle presence lift, soft saturation for weight
vo = hp(vo, 90)
vo = vo + 0.35 * bp(vo, 2500, 5500)
vo = np.tanh(vo * 1.6) / np.tanh(1.6)
vo /= np.max(np.abs(vo)) + 1e-9
# duck the music under the voice
active = np.convolve((np.abs(vo) > 0.02).astype(float), np.ones(int(0.25 * SR)) / int(0.25 * SR), mode="same")
duck = 1 - 0.5 * np.clip(active * 3, 0, 1)
duck = lp(duck, 6)

music /= np.max(np.abs(music)) + 1e-9
mix = music * 0.62 * duck + sfx * 0.55 + vo * 0.95
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.89
stereo = np.stack([mix, np.roll(mix, 9) * 0.98 + mix * 0.02], axis=1)  # tiny width
sf.write(f"{V}/mix.wav", stereo, SR)
sf.write(f"{V}/music_only.wav", music * 0.6, SR)
print("mix", TOTAL, "s")
