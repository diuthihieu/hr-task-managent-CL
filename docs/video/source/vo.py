import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro, EspeakConfig
import espeakng_loader
V = sys.argv[1]
k = Kokoro(f"{V}/models/kokoro-v1.0.onnx", f"{V}/models/voices-v1.0.bin", espeak_config=EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=f"{V}/espeak-ng-data")  # a copy of espeakng_loader's espeak-ng-data (its bundled path is not picked up))
# A confident, punchy narrator: Michael's clarity blended with Fenrir's weight.
voice = 0.6 * k.get_voice_style("am_michael") + 0.4 * k.get_voice_style("am_fenrir")
lines = [
  ("spark", "Every great team starts with a spark.", 1.0),
  ("believe", "An idea. A plan. People who believe.", 1.0),
  ("scattered", "But work got scattered. Chats. Spreadsheets. Endless tabs.", 1.08),
  ("flow", "What if everything... just flowed?", 0.95),
  ("introducing", "Introducing woli mobile. Your whole workspace, now in your pocket.", 1.02),
  ("ios", "On iPhone: open woli in Safari, tap Share, then Add to Home Screen.", 1.1),
  ("android", "On Android: tap Download for Android, install, and you're in.", 1.1),
  ("all", "Every feature, one tap away.", 1.05),
  ("day", "Your day, prioritized.", 1.05),
  ("matters", "Know what matters most.", 1.05),
  ("projects", "Move every project forward.", 1.05),
  ("ai", "Ask AI anything about your work.", 1.05),
  ("win", "Celebrate every win.", 1.05),
  ("miss", "And never miss what needs you.", 1.05),
  ("outro", "woli. Work, in flow. Download now, on iOS and Android.", 1.0),
]
meta = []
for key, text, speed in lines:
    audio, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
    # trim leading/trailing silence
    idx = np.where(np.abs(audio) > 0.01)[0]
    audio = audio[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]
    sf.write(f"{V}/vo/{key}.wav", audio, sr)
    meta.append({"key": key, "text": text, "dur": round(len(audio) / sr, 3), "sr": sr})
    print(key, round(len(audio) / sr, 2))
json.dump(meta, open(f"{V}/vo/meta.json", "w"), indent=1)
