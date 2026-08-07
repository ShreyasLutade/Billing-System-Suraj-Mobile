import { LoaderCircle } from "lucide-react";
import type { Ref } from "react";

export function LoadMoreSentinel({
  sentinelRef,
  hasMore,
  loadingMore,
  totalCount = 0,
  showEnd = true,
  label = "Loading more…",
  endLabel = "End",
}: {
  sentinelRef: Ref<HTMLDivElement>;
  hasMore: boolean;
  loadingMore: boolean;
  totalCount?: number;
  showEnd?: boolean;
  label?: string;
  endLabel?: string;
}) {
  const atEnd = !hasMore && !loadingMore && totalCount > 0 && showEnd;

  if (!hasMore && !loadingMore && !atEnd) return null;

  return (
    <div
      ref={hasMore ? sentinelRef : undefined}
      className="flex items-center justify-center gap-2 py-4 text-[13px] font-medium text-ink-500"
      aria-live="polite"
    >
      {loadingMore ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin text-ink-400" />
          {label}
        </>
      ) : hasMore ? (
        <span className="h-4" aria-hidden />
      ) : (
        <div className="flex w-full max-w-xs items-center gap-3 px-4">
          <span className="h-px flex-1 bg-ink-100" aria-hidden />
          <span className="shrink-0 tracking-wide text-ink-400">{endLabel}</span>
          <span className="h-px flex-1 bg-ink-100" aria-hidden />
        </div>
      )}
    </div>
  );
}
