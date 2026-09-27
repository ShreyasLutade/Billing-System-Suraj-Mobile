import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "../lib/api";
import { matchesElasticSearch } from "../lib/elasticSearch";
import type { RepairPlatform } from "../types";

type ModelName = { name: string; platform: RepairPlatform };

/** Phone model names from the shop catalogue, one per name (no RAM/storage). */
let cachedNames: ModelName[] | null = null;

async function loadModelNames(): Promise<ModelName[]> {
  if (cachedNames) return cachedNames;
  const { data } = await api.listPhoneModels();
  const byName = new Map<string, ModelName>();
  for (const model of data) {
    const key = model.name.trim().toLowerCase();
    if (key && !byName.has(key)) {
      byName.set(key, { name: model.name.trim(), platform: model.platform });
    }
  }
  cachedNames = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return cachedNames;
}

const MAX_SUGGESTIONS = 8;

/**
 * Text box for the phone name with suggestions from the model catalogue.
 * Picking a suggestion also reports its platform so iOS/Android can be set.
 */
export function PhoneNameInput({
  id,
  value,
  platform,
  hasError,
  onChange,
  onPickPlatform,
}: {
  id: string;
  value: string;
  platform: RepairPlatform | "";
  hasError: boolean;
  onChange: (value: string) => void;
  onPickPlatform: (platform: RepairPlatform) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [names, setNames] = useState<ModelName[]>(cachedNames ?? []);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    let active = true;
    loadModelNames()
      .then((list) => {
        if (active) setNames(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const suggestions = useMemo(() => {
    const query = value.trim();
    if (!query) return [];
    const pool = platform ? names.filter((item) => item.platform === platform) : names;
    return pool
      .filter((item) => matchesElasticSearch(item.name, query))
      .filter((item) => item.name.toLowerCase() !== query.toLowerCase())
      .slice(0, MAX_SUGGESTIONS);
  }, [names, platform, value]);

  const showList = open && suggestions.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [value, platform]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(item: ModelName) {
    onChange(item.name);
    onPickPlatform(item.platform);
    setOpen(false);
  }

  return (
    <div className="rp-suggest" ref={rootRef}>
      <input
        id={id}
        className={clsx("rp-input", hasError && "has-error")}
        placeholder="e.g. iPhone 13, Redmi Note 13"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${highlight}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!showList) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(suggestions[highlight]!);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul className="rp-suggest-list" id={listId} role="listbox">
          {suggestions.map((item, index) => (
            <li
              key={item.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={clsx("rp-suggest-item", index === highlight && "is-active")}
              onPointerDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
              onPointerEnter={() => setHighlight(index)}
            >
              <span>{item.name}</span>
              <small>{item.platform === "IOS" ? "iOS" : "Android"}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
