import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import {
  formatCapacityLabel,
  rankPhoneModels,
} from "../lib/phoneModelSearch";
import type { PhoneModel } from "../types";

type Props = {
  id?: string;
  platform: "IOS" | "ANDROID";
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
  onSelectModel: (model: PhoneModel) => void;
};

const cache: Partial<Record<"IOS" | "ANDROID", PhoneModel[]>> = {};
const inflight: Partial<Record<"IOS" | "ANDROID", Promise<PhoneModel[]>>> = {};

async function loadModels(platform: "IOS" | "ANDROID") {
  // Don't stick with an empty cache (e.g. seed wasn't ready yet).
  if (cache[platform]?.length) return cache[platform]!;
  if (!inflight[platform]) {
    inflight[platform] = api
      .listPhoneModels(platform)
      .then((res) => {
        if (res.data.length) {
          cache[platform] = res.data;
        } else {
          delete cache[platform];
        }
        return res.data;
      })
      .finally(() => {
        delete inflight[platform];
      });
  }
  return inflight[platform]!;
}

/** Invalidate cache after a new model is saved so next open sees it. */
export function invalidatePhoneModelCache(platform?: "IOS" | "ANDROID") {
  if (platform) {
    delete cache[platform];
    return;
  }
  delete cache.IOS;
  delete cache.ANDROID;
}

export function MobileNameSearch({
  id,
  platform,
  value,
  disabled,
  autoFocus,
  required,
  onChange,
  onSelectModel,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<PhoneModel[]>(() => cache[platform] || []);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(!cache[platform]);
    loadModels(platform)
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const suggestions = useMemo(
    () => rankPhoneModels(models, value, 10),
    [models, value],
  );

  useEffect(() => {
    setHighlight(0);
  }, [value, platform]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, []);

  function pick(model: PhoneModel) {
    onSelectModel(model);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      if (suggestions.length) setOpen(true);
      return;
    }
    if (!open || !suggestions.length) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && suggestions[highlight]) {
      event.preventDefault();
      pick(suggestions[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && value.trim().length >= 1 && suggestions.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
          aria-hidden
        />
        <input
          id={id}
          className="field pl-9"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList ? `${listId}-opt-${highlight}` : undefined
          }
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            platform === "IOS"
              ? "Search iPhone… e.g. 15 Pro 256"
              : "Search Android… e.g. S24 256 8"
          }
          autoComplete="off"
          spellCheck={false}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-ink-100 bg-white py-1 shadow-lg shadow-ink-900/10"
        >
          {suggestions.map((model, index) => {
            const active = index === highlight;
            return (
              <li key={model.id} role="presentation">
                <button
                  id={`${listId}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={
                    active
                      ? "flex w-full items-center gap-3 px-3 py-2.5 text-left bg-ink-900 text-white"
                      : "flex w-full items-center gap-3 px-3 py-2.5 text-left text-ink-800 hover:bg-ink-50"
                  }
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(model)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {model.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={
                        active
                          ? "rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
                          : "rounded-md bg-ink-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-800"
                      }
                    >
                      {formatCapacityLabel(model.storage)}
                    </span>
                    {model.platform === "ANDROID" && model.ram ? (
                      <span
                        className={
                          active
                            ? "rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
                            : "rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-sky-800 ring-1 ring-sky-100"
                        }
                      >
                        {formatCapacityLabel(model.ram)} RAM
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && value.trim().length >= 1 && !loading && !suggestions.length ? (
        <p className="mt-1.5 text-xs text-ink-400">
          No match — keep typing; this model will be saved when you add stock.
        </p>
      ) : null}
    </div>
  );
}
