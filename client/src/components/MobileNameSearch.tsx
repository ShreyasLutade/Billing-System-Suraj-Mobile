import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import {
  computeMenuPosition,
  subscribeOutsideDismiss,
  subscribeViewportChange,
  type MenuPosition,
} from "../lib/floatingMenu";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<PhoneModel[]>(
    () => cache[platform] || [],
  );
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(!cache[platform]?.length);
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

  const updateMenuPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;
    setMenuPos(
      computeMenuPosition(trigger, {
        gap: 6,
        minHeight: 140,
        maxHeightCap: 280,
      }),
    );
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [value, platform]);

  const showList = open && value.trim().length >= 1 && suggestions.length > 0;
  const showEmpty =
    open && value.trim().length >= 1 && !loading && !suggestions.length;

  useLayoutEffect(() => {
    if (!showList && !showEmpty) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    return subscribeViewportChange(updateMenuPosition);
  }, [showList, showEmpty, suggestions.length, updateMenuPosition, value]);

  useEffect(() => {
    if (!open) return;
    return subscribeOutsideDismiss((target) => {
      const node = target as Node | null;
      if (rootRef.current?.contains(node)) return true;
      if (menuRef.current?.contains(node)) return true;
      return false;
    }, () => setOpen(false));
  }, [open]);

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

  const menu =
    (showList || showEmpty) && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              zIndex: 80,
            }}
          >
            {showList ? (
              <ul
                id={listId}
                role="listbox"
                className="overflow-auto rounded-2xl border border-ink-100 bg-white p-1.5 shadow-[0_10px_24px_rgba(16,25,40,.10),0_30px_70px_-20px_rgba(16,25,40,.28)]"
                style={{ maxHeight: menuPos.maxHeight }}
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
                            ? "flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-left bg-[#E7F8F1]"
                            : "flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-left hover:bg-[#F4F7FA]"
                        }
                        onMouseEnter={() => setHighlight(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(model)}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
                          {model.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="rounded-md bg-[#EEF0F3] px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-800">
                            {formatCapacityLabel(model.storage)}
                          </span>
                          {model.platform === "ANDROID" && model.ram ? (
                            <span className="rounded-md bg-[#E8F0FE] px-2 py-0.5 text-xs font-semibold tabular-nums text-[#2563EB]">
                              {formatCapacityLabel(model.ram)} RAM
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-2xl border border-ink-100 bg-white px-3.5 py-3 text-[13.5px] text-ink-500 shadow-[0_10px_24px_rgba(16,25,40,.10)]">
                {platform === "IOS"
                  ? "No iOS match — switch to Android for Redmi, Samsung, etc."
                  : "No match — keep typing; this model will be saved when you add stock."}
              </p>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={clsx(
          "flex min-h-[48px] items-center gap-2.5 rounded-[13px] border-[1.5px] border-ink-100 bg-white px-3 transition",
          open &&
            "border-[#12B886] shadow-[0_0_0_4px_rgba(18,184,134,.14)]",
          disabled && "cursor-not-allowed opacity-55",
        )}
      >
        <Search
          className="h-[18px] w-[18px] shrink-0 text-ink-500"
          aria-hidden
        />
        <input
          id={id}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink-900 outline-none placeholder:text-[#9AA6B6] sm:text-[14.5px]"
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
              : "Search Android… e.g. Redmi Note 14"
          }
          autoComplete="off"
          spellCheck={false}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </div>
      {menu}
    </div>
  );
}
