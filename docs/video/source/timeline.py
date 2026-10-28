import json, sys
V = sys.argv[1]
BAR = 4 * 60 / 128
scenes = [
  ("spark", 0, 2), ("believe", 2, 4), ("scattered", 4, 6), ("flow", 6, 8),
  ("introducing", 8, 11), ("ios", 11, 14), ("android", 14, 17),
  ("all", 17, 18), ("day", 18, 19), ("matters", 19, 20), ("projects", 20, 21), ("ai", 21, 22), ("win", 22, 23), ("miss", 23, 24),
  ("outro", 24, 28),
]
offset = {"spark": 0.55, "believe": 0.3, "scattered": 0.15, "flow": 0.3, "introducing": 0.45, "ios": 0.2, "android": 0.2, "outro": 0.55}
tl = {"bar": BAR, "total": 52.5, "scenes": [], "vo": {}, "cuts": [], "taps": []}
for key, a, b in scenes:
    s, e = a * BAR, b * BAR
    tl["scenes"].append({"key": key, "start": round(s, 4), "end": round(e, 4)})
    tl["vo"][key] = round(s + offset.get(key, 0.12), 3)
    if a > 0 and key not in ("introducing", "outro", "believe", "scattered"):
        tl["cuts"].append(round(s, 3))
# taps in the install guide (ios: share, add to home; android: download) and feature tour
ios_s = 11 * BAR; and_s = 14 * BAR
tl["taps"] = [round(x, 3) for x in [ios_s + 1.9, ios_s + 3.6, and_s + 1.6, and_s + 3.4] + [ (17 + i) * BAR + 0.9 for i in range(7)]]
json.dump(tl, open(f"{V}/timeline.json", "w"), indent=1)
print(json.dumps(tl["scenes"]))
