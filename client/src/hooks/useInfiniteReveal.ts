import { useEffect, useMemo, useRef, useState } from "react";

export const PAGE_SIZE = 15;

/**
 * Reveals `pageSize` items at a time from an already-loaded list.
 * When the sentinel enters the viewport, the next page is appended
 * with a short "Loading more…" state for feedback.
 *
 * `restoreCount`: show this many again the first time the list has items
 * (coming back to a page that had revealed more).
 */
export function useInfiniteReveal<T>(
  items: T[],
  resetKey: string | number,
  pageSize: number = PAGE_SIZE,
  restoreCount?: number | null,
) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingLock = useRef(false);
  /** Count to show again, and the list (resetKey) it was used for. */
  const restore = useRef<{ count: number; key: string | number | null } | null>(
    restoreCount ? { count: restoreCount, key: null } : null,
  );
  const itemCount = useRef(items.length);
  itemCount.current = items.length;

  useEffect(() => {
    const pending = restore.current;
    // Kept for the same list, so a re-run of this effect doesn't undo it.
    if (pending && itemCount.current > 0 && (pending.key === null || pending.key === resetKey)) {
      pending.key = resetKey;
      setVisibleCount(Math.max(pageSize, pending.count));
    } else {
      restore.current = null;
      setVisibleCount(pageSize);
    }
    setLoadingMore(false);
    loadingLock.current = false;
  }, [resetKey, pageSize]);

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );
  const hasMore = visibleCount < items.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadingLock.current) return;

        loadingLock.current = true;
        setLoadingMore(true);

        window.setTimeout(() => {
          setVisibleCount((count) =>
            Math.min(count + pageSize, items.length),
          );
          setLoadingMore(false);
          loadingLock.current = false;
        }, 280);
      },
      { root: null, rootMargin: "160px 0px", threshold: 0 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, pageSize, items.length, visibleCount]);

  return {
    visibleItems,
    hasMore,
    loadingMore,
    sentinelRef,
    visibleCount,
    totalCount: items.length,
  };
}
