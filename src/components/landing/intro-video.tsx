import { PlayCircle } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/core";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The woli introduction video (a Google Drive file shared with "anyone with the link"). */
const DRIVE_FILE_ID = "1c1nYbnKe-I2hlWBu6Jk5nnwBC-4_PPhq";

// Drive's /preview player is the embeddable one; /view refuses to be framed.
export function IntroVideo({ t }: { t: T }) {
  return (
    <section id="video" className="scroll-mt-16 pb-16 md:pb-20" data-testid="landing-video">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-6 md:mb-8">
          <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            <PlayCircle size={13} /> {t("landing.video.badge")}
          </span>
          <h2 className="mt-4 text-2xl md:text-4xl font-bold tracking-tight">{t("landing.video.title")}</h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed">{t("landing.video.subtitle")}</p>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 shadow-xl shadow-neutral-900/10">
          <iframe
            src={`https://drive.google.com/file/d/${DRIVE_FILE_ID}/preview`}
            title={t("landing.video.title")}
            className="absolute inset-0 h-full w-full"
            loading="lazy"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="mt-3 text-center text-xs text-neutral-400">
          <a href={`https://drive.google.com/file/d/${DRIVE_FILE_ID}/view`} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 underline-offset-2 hover:underline">
            {t("landing.video.open")}
          </a>
        </p>
      </div>
    </section>
  );
}
