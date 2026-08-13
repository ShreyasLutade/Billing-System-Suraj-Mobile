import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readStoredTab, writeStoredTab } from "../lib/navMemory";

export function usePersistedTab<T extends string>(
  param: string,
  storageKey: string,
  allowed: readonly T[],
  defaultValue: T,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const parse = (value: string | null): T | null =>
    value && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : null;

  const [tab, setTab] = useState<T>(
    () =>
      parse(searchParams.get(param)) ||
      readStoredTab(storageKey, allowed, defaultValue),
  );

  const setTabAndRemember = useCallback(
    (next: T) => {
      setTab(next);
      writeStoredTab(storageKey, next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === defaultValue) params.delete(param);
          else params.set(param, next);
          return params;
        },
        { replace: true },
      );
    },
    [param, storageKey, defaultValue, setSearchParams],
  );

  useEffect(() => {
    writeStoredTab(storageKey, tab);
    const current = searchParams.get(param);
    const desired = tab === defaultValue ? null : tab;
    if ((current || null) === desired) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (desired) params.set(param, desired);
        else params.delete(param);
        return params;
      },
      { replace: true },
    );
  }, [tab, param, defaultValue, storageKey, searchParams, setSearchParams]);

  return [tab, setTabAndRemember];
}
