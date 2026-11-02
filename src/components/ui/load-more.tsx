"use client";

import { useT } from "@/components/i18n-provider";

/** "Load more" for a paged list (BUG-11); renders nothing when there is no further page. */
export function LoadMore({ hasMore, loading, onClick, label, testId = "load-more" }: { hasMore: boolean; loading: boolean; onClick: () => void; label?: string; testId?: string }) {
  const { t } = useT();
  if (!hasMore) return null;
  return (
    <button type="button" onClick={onClick} disabled={loading} data-testid={testId} className="w-full rounded-md py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-60 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
      {loading ? t("common.loading") : (label ?? t("common.loadMore"))}
    </button>
  );
}
