// Shared (client + server): notification groups the user can switch on/off
// per channel, and the ringtones. Ringtones are synthesized with Web Audio,
// so there are no sound files to host.

export const NOTIFY_GROUPS = [
  { key: "assigned", types: ["task_assigned", "task_report_added"] },
  { key: "mention", types: ["mention"] },
  { key: "comment", types: ["task_comment"] },
  { key: "due", types: ["task_due_soon", "task_overdue", "task_due_changed", "capture_due", "reminder"] },
  { key: "updates", types: ["task_status", "task_updated"] },
  { key: "approval", types: ["approval_request", "approval_result"] },
  { key: "invite", types: ["workspace_invite", "workspace_invite_result"] },
  { key: "okr", types: ["objective_risk"] },
  { key: "ai", types: ["ai_suggestion"] },
  { key: "recognition", types: ["kudos", "reward_request", "reward_result"] },
] as const;
export type NotifyGroup = (typeof NOTIFY_GROUPS)[number]["key"];
export const NOTIFY_GROUP_KEYS = NOTIFY_GROUPS.map((g) => g.key) as NotifyGroup[];

/** Which group a notification belongs to ("you can redeem a reward" counts as recognition). */
export function notifyGroupOf(n: { type: string; data?: unknown }): NotifyGroup | null {
  if (n.type === "ai_suggestion" && (n.data as { kind?: string } | null)?.kind === "reward_reachable") return "recognition";
  return NOTIFY_GROUPS.find((g) => (g.types as readonly string[]).includes(n.type))?.key ?? null;
}

export const RINGTONES = ["chime", "bell", "pop", "ding", "marimba", "digital", "soft", "none"] as const;
export type Ringtone = (typeof RINGTONES)[number];

export interface NotifySettings {
  popupOff: NotifyGroup[];
  nativeOff: NotifyGroup[];
  sound: Ringtone;
  volume: number;
}
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { popupOff: [], nativeOff: [], sound: "chime", volume: 70 };

// [frequency Hz, start s, duration s, oscillator type]
type Note = [number, number, number, OscillatorType];
const PATTERNS: Record<Exclude<Ringtone, "none">, Note[]> = {
  chime: [[880, 0, 0.35, "sine"], [1318.5, 0.12, 0.5, "sine"]],
  bell: [[1046.5, 0, 0.9, "triangle"], [2093, 0, 0.5, "sine"]],
  pop: [[620, 0, 0.09, "sine"], [930, 0.06, 0.1, "sine"]],
  ding: [[1567.98, 0, 0.6, "sine"]],
  marimba: [[523.25, 0, 0.18, "sine"], [659.25, 0.1, 0.18, "sine"], [783.99, 0.2, 0.3, "sine"]],
  digital: [[1200, 0, 0.07, "square"], [1200, 0.12, 0.07, "square"], [1600, 0.24, 0.1, "square"]],
  soft: [[440, 0, 0.5, "sine"], [554.37, 0.18, 0.6, "sine"]],
};

let ctx: AudioContext | null = null;
/** Play a ringtone (browser only). Returns false when audio is blocked or unavailable. */
export function playRingtone(name: Ringtone, volume = 70): boolean {
  if (name === "none" || typeof window === "undefined") return false;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.01;
    const peak = Math.max(0, Math.min(1, volume / 100)) * (name === "digital" ? 0.08 : 0.25);
    for (const [freq, start, dur, type] of PATTERNS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    }
    return true;
  } catch {
    return false;
  }
}
