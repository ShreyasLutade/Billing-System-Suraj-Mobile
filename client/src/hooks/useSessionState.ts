import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

const LIST_UI_PREFIXES = [
  "bills.",
  "stock.",
  "dues.",
  "suppliers.",
  "analytics.",
] as const;

const CLEAR_EVENT = "suraj:clear-list-ui";

/** While true, list UI is not written back to session (header nav in progress). */
let listUiPersistSuspended = false;

function readSessionJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (listUiPersistSuspended) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — ignore.
  }
}

/**
 * Drop list search / filter / sort memory. Call when the user switches pages
 * from the header so they see a clean list — keep memory only for
 * search → open detail → back.
 */
export function clearListUiSession() {
  listUiPersistSuspended = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (LIST_UI_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CLEAR_EVENT));
  }

  // Let the open list page reset in-memory state before writes are allowed again.
  queueMicrotask(() => {
    listUiPersistSuspended = false;
  });
}

/**
 * useState that survives leaving a list page into a detail and coming back
 * (e.g. bill search → detail → back). Cleared on header navigation via
 * {@link clearListUiSession}.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(initial);
  const [state, setState] = useState<T>(() => readSessionJson(key, initial));

  useEffect(() => {
    const onClear = () => {
      setState(initialRef.current);
    };
    window.addEventListener(CLEAR_EVENT, onClear);
    return () => window.removeEventListener(CLEAR_EVENT, onClear);
  }, []);

  useEffect(() => {
    writeSessionJson(key, state);
  }, [key, state]);

  const setAndRemember = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setState((prev) => {
        const value =
          typeof next === "function"
            ? (next as (prevState: T) => T)(prev)
            : next;
        writeSessionJson(key, value);
        return value;
      });
    },
    [key],
  );

  return [state, setAndRemember];
}
