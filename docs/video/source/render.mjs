import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const V = process.argv[2];
const mode = process.argv[3] || "full"; // "full" or comma list of seconds for stills
const FPS = 30;
const TL = JSON.parse(fs.readFileSync(V + "/timeline.json"));
const TAPS = JSON.parse(fs.readFileSync(V + "/taps.json"));
const b = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.addInitScript(([tl, taps]) => { window.TIMELINE = tl; window.TAPS = taps; }, [TL, TAPS]);
await p.goto("file://" + V + "/scene.html");
await p.evaluate(() => window.ready);
await p.evaluate(() => document.fonts.ready);
if (mode !== "full") {
  fs.mkdirSync(V + "/stills", { recursive: true });
  for (const s of mode.split(",").map(Number)) {
    await p.evaluate(([t, f]) => window.render(t, f), [s, Math.round(s * FPS)]);
    await p.screenshot({ path: `${V}/stills/${String(s).replace(".", "_")}.jpg`, type: "jpeg", quality: 85 });
  }
} else {
  fs.rmSync(V + "/frames", { recursive: true, force: true });
  fs.mkdirSync(V + "/frames", { recursive: true });
  const N = Math.round(TL.total * FPS);
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await p.evaluate(([t, f]) => window.render(t, f), [f / FPS, f]);
    await p.screenshot({ path: `${V}/frames/${String(f).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
    if (f % 150 === 0) console.log("frame", f, "/", N, Math.round((Date.now() - t0) / 1000) + "s");
  }
}
await b.close();
