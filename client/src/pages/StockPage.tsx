import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowDownUp,
  Cable,
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { AddStockLocationState } from "./AddStockPage";
import { useAuth } from "../auth/AuthContext";
import { BackButton, EmptyState, LoadingBlock, PageHeader, SearchClearButton } from "../components/ui";
import { EditStockUnitModal } from "../components/EditStockUnitModal";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { usePersistedTab } from "../hooks/usePersistedTab";
import { useSessionState } from "../hooks/useSessionState";
import { fromState } from "../lib/navMemory";
import { api, formatINR, formatStockUnitId, round2 } from "../lib/api";
import { matchesElasticFields } from "../lib/elasticSearch";
import type { StockItem } from "../types";

type StockTab = "NEW" | "USED" | "ACCESSORY";
type SortKey = "latest" | "model" | "qty" | "avg" | "total";

const SORT_FIELD_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "latest", label: "Latest" },
  { key: "model", label: "Model" },
  { key: "qty", label: "Qty" },
  { key: "avg", label: "Avg price" },
  { key: "total", label: "Total value" },
];

function stockSortLabel(key: SortKey, dir: 1 | -1) {
  if (key === "latest") {
    return dir === -1 ? "Newest" : "Oldest";
  }
  const base =
    key === "model"
      ? "Model"
      : key === "qty"
        ? "Qty"
        : key === "avg"
          ? "Avg price"
          : "Total value";
  if (key === "model") {
    return dir === 1 ? "A → Z" : "Z → A";
  }
  return `${base} ${dir === -1 ? "↓" : "↑"}`;
}

type StockGroup = {
  key: string;
  productName: string;
  color: string;
  storage: string;
  ram: string;
  platform: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierIsExchange: boolean;
  quantity: number;
  avgPrice: number;
  totalValue: number;
  /** Newest unit createdAt in this group (ms). */
  latestAt: number;
  units: StockItem[];
};

function normalizeProductName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeField(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stockGroupKey(item: StockItem) {
  const name = normalizeProductName(item.mobileName || "Unknown");
  const color = normalizeField(item.color || "");
  const storage = normalizeField(item.storage || "");
  const ram =
    item.platform === "ANDROID" ? normalizeField(item.ram || "") : "";
  return [name, color, storage, ram].join("|");
}

function formatVariant(
  group: Pick<StockGroup, "color" | "storage" | "ram" | "platform">,
) {
  return [
    group.color || null,
    group.storage || null,
    group.platform === "ANDROID" && group.ram ? group.ram : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatProductLabel(
  group: Pick<
    StockGroup,
    "productName" | "color" | "storage" | "ram" | "platform"
  >,
) {
  return [group.productName, formatVariant(group) || null]
    .filter(Boolean)
    .join(" · ");
}

function groupStockByProduct(items: StockItem[]): StockGroup[] {
  const groups = new Map<string, StockItem[]>();
  for (const item of items) {
    const key = stockGroupKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .map(([key, units]) => {
      const sample = units[0];
      const totalValue = units.reduce(
        (sum, unit) => sum + (unit.purchasePrice || 0),
        0,
      );
      const quantity = units.length;
      const latestAt = units.reduce((max, unit) => {
        const t = new Date(unit.createdAt).getTime();
        return Number.isFinite(t) && t > max ? t : max;
      }, 0);
      return {
        key,
        productName: sample?.mobileName.trim() || "Unknown",
        color: sample?.color.trim() || "",
        storage: sample?.storage.trim() || "",
        ram: sample?.platform === "ANDROID" ? sample.ram.trim() || "" : "",
        platform: sample?.platform || "",
        supplierId: sample?.supplierId || null,
        supplierName: sample?.supplierName || sample?.suppliers?.[0] || null,
        supplierIsExchange: Boolean(sample?.supplierIsExchange),
        quantity,
        avgPrice: quantity ? round2(totalValue / quantity) : 0,
        totalValue: round2(totalValue),
        latestAt,
        units: [...units].sort((a, b) =>
          formatStockUnitId(a).localeCompare(formatStockUnitId(b)),
        ),
      };
    })
    .sort((a, b) =>
      formatProductLabel(a).localeCompare(formatProductLabel(b)),
    );
}

function formatPurchaseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function addedByLabel(name?: string | null) {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

function StockIntakeBadge({
  kind,
  isExchange,
}: {
  kind?: "exchange" | "return" | null;
  isExchange?: boolean;
}) {
  const isReturn = kind === "return";
  const isEx = !isReturn && (kind === "exchange" || Boolean(isExchange));
  if (!isReturn && !isEx) return null;
  return (
    <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
      {isReturn ? "Return" : "Exchange"}
    </span>
  );
}

function sortGroups(
  groups: StockGroup[],
  sortKey: SortKey,
  sortDir: 1 | -1,
) {
  return [...groups].sort((a, b) => {
    if (sortKey === "latest") {
      return (a.latestAt - b.latestAt) * sortDir;
    }
    if (sortKey === "model") {
      const x = a.productName.toLowerCase();
      const y = b.productName.toLowerCase();
      if (x < y) return -1 * sortDir;
      if (x > y) return 1 * sortDir;
      return 0;
    }
    if (sortKey === "qty") return (a.quantity - b.quantity) * sortDir;
    if (sortKey === "avg") return (a.avgPrice - b.avgPrice) * sortDir;
    return (a.totalValue - b.totalValue) * sortDir;
  });
}

export function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const locationState = (location.state || null) as {
    condition?: StockTab;
  } | null;
  const [tab, setTab] = usePersistedTab(
    "condition",
    "stock.tab",
    ["NEW", "USED", "ACCESSORY"] as const,
    "NEW",
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const itemFromUrl = searchParams.get("item");
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useSessionState("stock.query", "");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<StockItem | null>(null);
  const [selectedKey, setSelectedKeyState] = useState<string | null>(
    () => itemFromUrl,
  );

  const setSelectedKey = useCallback(
    (key: string | null) => {
      setSelectedKeyState(key);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          const current = params.get("item");
          if (key) {
            if (current === key) return prev;
            params.set("item", key);
          } else if (!current) {
            return prev;
          } else {
            params.delete("item");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (itemFromUrl) setSelectedKeyState(itemFromUrl);
  }, [itemFromUrl]);
  const [sortKey, setSortKey] = useSessionState<SortKey>("stock.sortKey", "model");
  const [sortDir, setSortDir] = useSessionState<1 | -1>("stock.sortDir", 1);
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      locationState?.condition === "USED" ||
      locationState?.condition === "NEW" ||
      locationState?.condition === "ACCESSORY"
    ) {
      setTab(locationState.condition);
    }
  }, [locationState?.condition, setTab]);

  function openAddMobilePage() {
    const condition = tab === "USED" ? "USED" : "NEW";
    const state: AddStockLocationState = {
      condition,
    };
    navigate("/stock/add", { state });
  }

  function openAddAccessoriesPage() {
    navigate("/stock/accessories/add");
  }

  async function loadStock(activeTab: StockTab) {
    setLoading(true);
    try {
      const response =
        activeTab === "ACCESSORY"
          ? await api.listStock(undefined, undefined, "ACCESSORY")
          : await api.listStock(activeTab);
      setItems(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStock(tab);
  }, [tab]);

  const prevTabRef = useRef(tab);
  useEffect(() => {
    if (prevTabRef.current === tab) return;
    prevTabRef.current = tab;
    setSelectedKey(null);
  }, [tab, setSelectedKey]);

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        sortWrapRef.current &&
        !sortWrapRef.current.contains(event.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((item) =>
      matchesElasticFields(
        [
          item.mobileName,
          item.color,
          item.storage,
          item.ram,
          item.imei,
          item.serialNumber || "",
          item.platform,
          item.supplierName || "",
          ...item.suppliers,
        ],
        query,
      ),
    );
  }, [items, query]);

  const groups = useMemo(() => groupStockByProduct(filtered), [filtered]);
  const sortedGroups = useMemo(
    () => sortGroups(groups, sortKey, sortDir),
    [groups, sortKey, sortDir],
  );
  const stockReveal = useInfiniteReveal(
    sortedGroups,
    `${tab}|${query}|${sortKey}|${sortDir}|${sortedGroups.length}`,
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.key === selectedKey) || null,
    [groups, selectedKey],
  );

  const tabGroups = useMemo(() => groupStockByProduct(items), [items]);
  const summaryUnits = items.length;
  const summaryModels = tabGroups.length;
  const summaryValue = round2(
    items.reduce((sum, item) => sum + (item.purchasePrice || 0), 0),
  );

  const totalQty = filtered.length;
  const totalValue = round2(
    filtered.reduce((sum, item) => sum + (item.purchasePrice || 0), 0),
  );

  async function removeItem(item: StockItem) {
    if (
      !window.confirm(
        `Remove ${item.mobileName} (${formatStockUnitId(item)}) from stock?`,
      )
    ) {
      return;
    }
    setDeletingId(item.id);
    setError(null);
    try {
      await api.deleteStockItem(item.id);
      setItems((current) => {
        const next = current.filter((row) => row.id !== item.id);
        if (!next.some((row) => stockGroupKey(row) === stockGroupKey(item))) {
          setSelectedKey(null);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setDeletingId(null);
    }
  }

  function applyEditedUnit(updated: StockItem) {
    setItems((current) =>
      current.map((row) => (row.id === updated.id ? updated : row)),
    );
    setSelectedKey(stockGroupKey(updated));
    setError(null);
  }

  if (selectedKey && loading && !selectedGroup) {
    return <LoadingBlock label="Loading stock…" />;
  }

  if (selectedGroup) {
    return (
      <>
        <StockProductDetail
          group={selectedGroup}
          condition={tab}
          deletingId={deletingId}
          error={error}
          isAdmin={isAdmin}
          onBack={() => setSelectedKey(null)}
          onEdit={setEditingUnit}
          onRemove={(unit) => void removeItem(unit)}
        />
        {editingUnit && isAdmin && editingUnit.kind !== "ACCESSORY" ? (
          <EditStockUnitModal
            unit={editingUnit}
            onClose={() => setEditingUnit(null)}
            onSaved={applyEditedUnit}
          />
        ) : null}
      </>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Stock"
        description="Mobiles and accessories currently in the shop."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => openAddAccessoriesPage()}
            >
              <Cable className="h-4 w-4" />
              Add accessories
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => openAddMobilePage()}
            >
              <Plus className="h-4 w-4" />
              Add mobile
            </button>
          </div>
        }
      />

      <div className="tb-toolbar">
        <div className="tb-tabs tb-tabs-3" role="tablist" aria-label="Stock type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "NEW"}
            className={clsx("tb-tab", tab === "NEW" && "tb-tab-on")}
            onClick={() => setTab("NEW")}
          >
            <Smartphone className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            New
            {tab === "NEW" ? (
              <span className="tb-cnt">{summaryUnits}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "USED"}
            className={clsx("tb-tab", tab === "USED" && "tb-tab-on")}
            onClick={() => setTab("USED")}
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Used</span>
            <span className="hidden sm:inline">Second hand</span>
            {tab === "USED" ? (
              <span className="tb-cnt">{summaryUnits}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ACCESSORY"}
            className={clsx("tb-tab", tab === "ACCESSORY" && "tb-tab-on")}
            onClick={() => setTab("ACCESSORY")}
          >
            <Cable className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Acc.</span>
            <span className="hidden sm:inline">Accessories</span>
            {tab === "ACCESSORY" ? (
              <span className="tb-cnt">{summaryUnits}</span>
            ) : null}
          </button>
        </div>

        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                tab === "ACCESSORY"
                  ? "Search accessory or serial…"
                  : "Search product, IMEI, supplier…"
              }
              aria-label="Search stock"
            />
            <SearchClearButton
              visible={Boolean(query)}
              onClear={() => setQuery("")}
            />
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between gap-3 rounded-[12px] bg-[#0E1626] px-3.5 py-2 shadow-soft dark:border dark:border-ink-100 dark:!bg-surface-elevated">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55 dark:!text-ink-500">
            Stock value
          </p>
          <p className="font-display text-[15px] font-semibold tabular-nums tracking-tight text-white dark:!text-[#F8FAFC]">
            {loading ? "…" : formatINR(summaryValue)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-ink-100/80 bg-white px-3.5 py-2 shadow-soft dark:border-ink-100 dark:!bg-surface">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
            Units in stock
          </p>
          <p className="font-display text-[15px] font-semibold tabular-nums tracking-tight text-ink-900">
            {loading ? "…" : summaryUnits}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-ink-100/80 bg-white px-3.5 py-2 shadow-soft dark:border-ink-100 dark:!bg-surface">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
            {tab === "ACCESSORY" ? "Distinct names" : "Distinct models"}
          </p>
          <p className="font-display text-[15px] font-semibold tabular-nums tracking-tight text-ink-900">
            {loading ? "…" : summaryModels}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading stock…" />
      ) : groups.length === 0 ? (
        <EmptyState
          title={
            query.trim()
              ? "No matching items"
              : tab === "NEW"
                ? "No new mobiles yet"
                : tab === "USED"
                  ? "No second-hand mobiles yet"
                  : "No accessories yet"
          }
          description={
            query.trim()
              ? "Try a different search."
              : tab === "ACCESSORY"
                ? "Tap Add accessories to record chargers, covers, and more."
                : "Tap Add mobile to record a purchase into stock."
          }
        />
      ) : (
        <>
          <div className="mb-2.5 flex items-center justify-between gap-3 px-1 text-[13px] text-ink-500">
            <span>
              Showing <b className="font-semibold text-ink-900">{groups.length}</b>{" "}
              models · <b className="font-semibold text-ink-900">{totalQty}</b>{" "}
              units
            </span>
            <div className="relative shrink-0" ref={sortWrapRef}>
              <button
                type="button"
                className={clsx(
                  "inline-flex items-center justify-center gap-2 rounded-[11px] border bg-white p-2.5 text-[13px] font-semibold text-ink-700 shadow-soft transition sm:px-3.5 sm:py-2",
                  sortOpen
                    ? "border-ink-900 text-ink-900"
                    : "border-ink-100 text-ink-500 hover:border-ink-300 hover:text-ink-900",
                )}
                aria-haspopup="true"
                aria-expanded={sortOpen}
                aria-label={`Sort: ${stockSortLabel(sortKey, sortDir)}`}
                title={`Sort: ${stockSortLabel(sortKey, sortDir)}`}
                onClick={() => setSortOpen((open) => !open)}
              >
                <ArrowDownUp
                  className="h-4 w-4 text-ink-500 sm:h-[15px] sm:w-[15px] sm:text-ink-300"
                  strokeWidth={2}
                />
                <span className="hidden sm:inline">
                  Sort:{" "}
                  <b className="font-semibold text-ink-900">
                    {stockSortLabel(sortKey, sortDir)}
                  </b>
                </span>
                <ChevronDown
                  className={clsx(
                    "hidden h-[13px] w-[13px] text-ink-300 transition sm:block",
                    sortOpen && "rotate-180",
                  )}
                  strokeWidth={2}
                />
              </button>

              {sortOpen ? (
                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-40 w-[230px] origin-top-right rounded-[14px] border border-ink-100 bg-white p-3 shadow-[0_8px_20px_rgba(16,25,40,.10),0_24px_60px_rgba(16,25,40,.16)]"
                  role="menu"
                  aria-label="Sort stock"
                >
                  <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                    Direction
                  </p>
                  <div className="mb-3 grid grid-cols-2 gap-0.5 rounded-[10px] bg-[#EEF0F3] p-[3px]">
                    <button
                      type="button"
                      className={clsx(
                        "rounded-[7px] px-2 py-1.5 text-center text-xs transition",
                        sortDir === -1
                          ? "bg-white font-semibold text-ink-900 shadow-soft"
                          : "font-medium text-ink-500 hover:text-ink-900",
                      )}
                      onClick={() => setSortDir(-1)}
                    >
                      {sortKey === "latest" ? "Newest" : "High → Low"}
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        "rounded-[7px] px-2 py-1.5 text-center text-xs transition",
                        sortDir === 1
                          ? "bg-white font-semibold text-ink-900 shadow-soft"
                          : "font-medium text-ink-500 hover:text-ink-900",
                      )}
                      onClick={() => setSortDir(1)}
                    >
                      {sortKey === "latest" ? "Oldest" : "Low → High"}
                    </button>
                  </div>

                  <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                    Sort by
                  </p>
                  <div className="space-y-0.5">
                    {SORT_FIELD_OPTIONS.map((option) => {
                      const on = sortKey === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          className={clsx(
                            "flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[13.5px] transition",
                            on
                              ? "bg-[#F1F5FF] font-semibold text-ink-900"
                              : "font-medium text-ink-500 hover:bg-[#F4F5F7] hover:text-ink-900",
                          )}
                          onClick={() => {
                            setSortKey(option.key);
                            if (option.key === "latest") setSortDir(-1);
                          }}
                        >
                          {option.label}
                          <Check
                            className={clsx(
                              "h-[15px] w-[15px] text-[#2563EB]",
                              on ? "opacity-100" : "opacity-0",
                            )}
                            strokeWidth={2.6}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="ledger-card">
            <div className="ledger-scroll">
              <table className="ledger-table min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Variant</th>
                    <th className="text-center">Qty</th>
                    <th className="text-right">Avg price</th>
                    <th className="text-right">Total value</th>
                  </tr>
                </thead>
                <tbody>
                  {stockReveal.visibleItems.map((group) => {
                    const variant = formatVariant(group);
                    return (
                      <tr
                        key={group.key}
                        className="ledger-row-click"
                        onClick={() => setSelectedKey(group.key)}
                      >
                        <td className="font-semibold text-ink-900">
                          {group.productName}
                        </td>
                        <td className="text-ink-500">{variant || "—"}</td>
                        <td className="text-center">
                          <span
                            className={clsx(
                              "tabular-nums font-semibold",
                              group.quantity > 1
                                ? "text-[#2563EB]"
                                : "text-ink-500",
                            )}
                          >
                            {group.quantity}
                          </span>
                        </td>
                        <td className="text-right tabular-nums text-ink-500">
                          {formatINR(group.avgPrice)}
                        </td>
                        <td className="text-right tabular-nums font-bold text-ink-900">
                          {formatINR(group.totalValue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="text-center tabular-nums">{totalQty}</td>
                    <td className="text-right text-ink-300">—</td>
                    <td className="text-right text-[15px] tabular-nums">
                      {formatINR(totalValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <LoadMoreSentinel
              sentinelRef={stockReveal.sentinelRef}
              hasMore={stockReveal.hasMore}
              loadingMore={stockReveal.loadingMore}
              totalCount={stockReveal.totalCount}
              showEnd={false}
            />
            <p className="ledger-note">
              Tap a row for unit-level detail (IMEI, purchase date, supplier).
              Manage suppliers under{" "}
              <Link
                to="/suppliers"
                className="font-medium text-[#2563EB] hover:underline"
              >
                Suppliers
              </Link>
              .
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StockProductDetail({
  group,
  condition,
  deletingId,
  error,
  isAdmin,
  onBack,
  onEdit,
  onRemove,
}: {
  group: StockGroup;
  condition: StockTab;
  deletingId: string | null;
  error: string | null;
  isAdmin: boolean;
  onBack: () => void;
  onEdit: (unit: StockItem) => void;
  onRemove: (unit: StockItem) => void;
}) {
  const location = useLocation();
  const title = formatProductLabel(group);
  const units = [...group.units].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const isUsed = condition === "USED";
  const isAccessory = condition === "ACCESSORY";

  return (
    <div>
      <div className="mb-3">
        <BackButton className="mb-4" onClick={onBack}>
          Back to stock
        </BackButton>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-semibold leading-snug text-ink-900 sm:text-2xl">
            {isAccessory ? group.productName : title}
          </h1>
          <span
            className={
              isAccessory
                ? "rounded border border-ink-200 bg-ink-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-700"
                : isUsed
                  ? "rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ember-500"
                  : "rounded border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-tide-700"
            }
          >
            {isAccessory ? "Accessory" : isUsed ? "Second hand" : "New"}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {group.quantity} unit{group.quantity === 1 ? "" : "s"} · Avg{" "}
          {formatINR(group.avgPrice)} · Total {formatINR(group.totalValue)}
          {group.supplierName ? (
            <>
              {" · "}
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {group.supplierName}
                {group.units.some((unit) => unit.intakeKind === "return") ? (
                  <StockIntakeBadge kind="return" />
                ) : group.supplierIsExchange ||
                  group.units.some((unit) => unit.intakeKind === "exchange") ? (
                  <StockIntakeBadge kind="exchange" />
                ) : null}
              </span>
            </>
          ) : null}
        </p>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="ledger-card">
        <div className="ledger-scroll">
          <table className="ledger-table min-w-[44rem]">
            <thead>
              <tr>
                <th>Purchase date</th>
                <th>Supplier name</th>
                <th className="text-right">Price</th>
                <th>{isAccessory ? "Serial" : "IMEI / Serial"}</th>
                <th className="w-[1%] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => {
                const addedBy = addedByLabel(unit.createdByName);
                return (
                <tr key={unit.id}>
                  <td className="text-ink-800">
                    <span className="whitespace-nowrap">
                      {formatPurchaseDate(unit.createdAt)}
                    </span>
                    {addedBy ? (
                      <span className="text-ink-500"> by {addedBy}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-normal text-ink-800">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {unit.supplierName || unit.suppliers[0] || "—"}
                      <StockIntakeBadge
                        kind={unit.intakeKind}
                        isExchange={unit.supplierIsExchange}
                      />
                    </span>
                    {unit.supplierId ? (
                      <>
                        {" "}
                        <Link
                          to={`/suppliers/${unit.supplierId}`}
                          state={fromState(location)}
                          className="text-xs text-[#2563EB] hover:underline"
                        >
                          ledger
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums text-ink-800">
                    {formatINR(unit.purchasePrice)}
                  </td>
                  <td className="font-mono text-ink-800">
                    {formatStockUnitId(unit)}
                  </td>
                  <td className="w-[1%] whitespace-nowrap text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {isAdmin && !isAccessory ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-semibold text-tide-700 hover:bg-tide-100 disabled:opacity-50 dark:border-tide-400/35 dark:bg-tide-100/20 dark:text-tide-400 dark:hover:bg-tide-100/35"
                          onClick={() => onEdit(unit)}
                        >
                          <SquarePen className="h-3 w-3" />
                          Edit
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                        disabled={deletingId === unit.id}
                        onClick={() => onRemove(unit)}
                      >
                        <Trash2 className="h-3 w-3" />
                        {deletingId === unit.id ? "…" : "Remove"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
