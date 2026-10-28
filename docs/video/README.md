# woli mobile – launch video (9:16, 52.5 s)

Files:
- `woli-mobile-launch-9x16.mp4`: 1080×1920, 30 fps, H.264 (CRF 25) + AAC 192 kbps, about 20 MB, ready to post.
  The CRF 18 master (about 90 MB) is not committed, to keep the repository small. Rebuild it from `source/` if needed.
- `source/`: everything needed to rebuild the video (see "Rebuild" below).

## Structure and voice-over (English)

| Time | Scene | Voice-over |
|---|---|---|
| 0:00–0:03.7 | Spark of light in the dark (brand) | "Every great team starts with a spark." |
| 0:03.7–0:07.5 | Team constellation forming | "An idea. A plan. People who believe." |
| 0:07.5–0:11.2 | One phone, too many windows: a team chat with buzzing notifications, then a broken spreadsheet (#REF!), then tabs multiplying to 31, each stacking on top of the last | "But work got scattered. Chats. Spreadsheets. Endless tabs." |
| 0:11.2–0:15.0 | Everything freezes, folds into a deck, shrinks into an orange dot, which pops and bursts into an orange ribbon (build-up) | "What if everything... just flowed?" |
| 0:15.0–0:20.6 | **Drop**: woli logo, "Introducing woli mobile", phone | "Introducing woli mobile. Your whole workspace, now in your pocket." |
| 0:20.6–0:26.2 | iPhone install: Safari, then Share, then Add to Home Screen | "On iPhone: open woli in Safari, tap Share, then Add to Home Screen." |
| 0:26.2–0:31.9 | Android install: Download, then Install, then Open | "On Android: tap Download for Android, install, and you're in." |
| 0:31.9–0:45.0 | Feature tour, 7 cuts of 1.9 s each (All, Home, Eisenhower, Projects, AI, Recognition, Action center) | "Every feature, one tap away. / Your day, prioritized. / Know what matters most. / Move every project forward. / Ask AI anything about your work. / Celebrate every win. / And never miss what needs you." |
| 0:45.0–0:52.5 | Outro: logo, "Work, in flow.", Download now, iPhone and Android, URL, mascot | "woli. Work, in flow. Download now, on iOS and Android." |

## How it was made

- **Picture:** the app screens are the real woli UI. I captured them on an iPhone 14 / Pixel 7 emulator with English demo data ("People Ops" workspace). They are shown inside a 3D phone frame. On top of that: cinematic light, bokeh, film grain and vignette, kinetic typography in Inter Display, and the woli brand colours (orange gradient #ff4d12 → #ffb63c, navy #0b1220, cream #fff7ed). The woli logo and the robot mascot come from the app.
- **Music:** an original 128 BPM track, synthesized in code: inspirational pad and piano intro, build-up, then a 4-on-the-floor drop with side-chained synths. No samples or third-party music, so there are no copyright issues.
- **Voice-over:** Kokoro TTS (open-source, Apache-2.0), using a blend of the voices "Michael" and "Fenrir" for a strong narrator. The music ducks under the voice. Loudness is about -12.6 LUFS, suitable for TikTok, Reels and Shorts.
- **Note:** I checked timing, loudness and peaks technically, but I cannot listen to the audio. Please listen once. For a more human voice, record or use a commercial TTS service and replace the voice track. Scene timings are in `timeline.json`.

## Real-footage version (optional)

This environment cannot generate photorealistic footage. If you want real people in the brand intro (0:00–0:15), generate 4 clips of 3.7 s each in 9:16 with Veo, Sora, Runway or Kling, then replace the first 15 seconds in CapCut or Premiere. Keep the same voice-over and music.

1. **Spark**: "Cinematic vertical 9:16 shot, close-up of a young Asian woman's face lit by a warm orange glow from a laptop in a dark modern office at night, shallow depth of field, anamorphic bokeh, slow push-in, film grain, teal and orange grade, 24fps, realistic."
2. **Believe**: "Vertical 9:16, a diverse team of four in their late 20s gathered around a whiteboard covered with sticky notes, one person sketches a plan, others nod and smile, warm window light, handheld documentary feel, realistic skin tones, shallow depth of field."
3. **Scattered**: "Vertical 9:16, an overwhelmed office worker at a desk with three monitors full of spreadsheets and chat notifications, phone buzzing on the desk, quick handheld micro-movements, slightly desaturated cool tones, realistic, tense mood."
4. **Flow**: "Vertical 9:16, the same worker picks up a smartphone and smiles as warm orange light washes over the scene, the cluttered screens behind blur out, slow-motion, golden hour light through the window, cinematic, hopeful mood, realistic."

Note for the AI generator: leave brand logos out of the generated footage. Keep the woli logo and app screens from this video so the branding stays exact.

## Rebuild

Work in an empty folder `$V`, with `assets/` (logo.png, mascot.png, shots/*.png) and `models/` (Kokoro `kokoro-v1.0.onnx` and `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx releases).

1. `python3 source/timeline.py $V`: writes the scene, voice-over and cut times (`timeline.json`).
2. `python source/vo.py $V`: renders the voice-over lines into `vo/`. Needs pip `kokoro-onnx soundfile numpy`.
3. `python source/music.py $V`: renders the soundtrack, SFX and voice-over into `mix.wav`. Needs `scipy`.
4. `node source/render.mjs $V full`: renders the frames with Playwright (`scene.html`, 30 fps).
5. `ffmpeg -framerate 30 -i frames/%05d.jpg -i mix.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest out.mp4`

The app screenshots come from a local demo workspace (English UI, iPhone 14 at 390×786 and Pixel 7 at 412×830). `taps.json` stores where each scene's finger taps land on those screenshots.
