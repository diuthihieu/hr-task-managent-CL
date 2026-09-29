// Letter fonts (self-hosted by next/font, with the Vietnamese subset so
// diacritics render correctly: "rất nhiều", not "rấ t nhiề u").
import { Be_Vietnam_Pro, Dancing_Script, Lora, Playfair_Display } from "next/font/google";

export const letterSerif = Lora({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-letter", display: "swap" });
export const letterScript = Dancing_Script({ subsets: ["latin", "vietnamese"], weight: ["500", "700"], variable: "--font-script", display: "swap" });
export const letterSans = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-letter-sans", display: "swap" });
export const letterDisplay = Playfair_Display({ subsets: ["latin", "vietnamese"], weight: ["500", "600", "700"], style: ["normal", "italic"], variable: "--font-letter-display", display: "swap" });

export const letterFontVars = [letterSerif.variable, letterScript.variable, letterSans.variable, letterDisplay.variable].join(" ");
