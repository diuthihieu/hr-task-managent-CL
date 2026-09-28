import Link from "next/link";
import { Brand } from "@/components/brand/brand";

export interface LegalSection {
  title: string;
  body: string[];
}

/** Plain, readable layout for the public Privacy Policy / Terms pages. */
export function LegalPage({ title, updated, intro, sections, backLabel }: { title: string; updated: string; intro: string; sections: LegalSection[]; backLabel: string }) {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200">
      <header className="border-b border-neutral-100 dark:border-neutral-900">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" aria-label="woli.">
            <Brand size={28} textClassName="text-lg" />
          </Link>
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            {backLabel}
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-10 md:py-14">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-neutral-500">{updated}</p>
        <p className="mt-6 leading-relaxed">{intro}</p>
        {sections.map((s, i) => (
          <section key={s.title} className="mt-8">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              {i + 1}. {s.title}
            </h2>
            {s.body.map((p) => (
              <p key={p} className="mt-2 leading-relaxed text-neutral-700 dark:text-neutral-300">
                {p}
              </p>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}

/** Where people send privacy / account requests: SUPPORT_EMAIL, else the bootstrap admin. */
export function supportEmail() {
  return process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || "";
}
