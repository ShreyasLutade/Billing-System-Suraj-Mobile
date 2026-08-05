import { useEffect, useMemo, useState, Fragment } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  Plus,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { AddStockLocationState } from "./AddStockPage";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { api, formatINR, round2 } from "../lib/api";
import type { StockHistory, StockItem } from "../types";

type StockTab = "NEW" | "USED";

type StockGroup = {
  key: string;
  productName: string;
  color: string;
  storage: string;
  ram: string;
  platform: string;
  supplierId: string | null;
  supplierName: string | null;
  quantity: number;
  avgPrice: number;
  totalValue: number;
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

function formatProductLabel(
  group: Pick<
    StockGroup,
    "productName" | "color" | "storage" | "ram" | "platform"
  >,
) {
  return [
    group.productName,
    group.color || null,
    group.storage || null,
    group.platform === "ANDROID" && group.ram ? group.ram : null,
  ]
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
      return {
        key,
        productName: sample?.mobileName.trim() || "Unknown",
        color: sample?.color.trim() || "",
        storage: sample?.storage.trim() || "",
        ram: sample?.platform === "ANDROID" ? sample.ram.trim() || "" : "",
        platform: sample?.platform || "",
        supplierId: sample?.supplierId || null,
        supplierName: sample?.supplierName || sample?.suppliers?.[0] || null,
        quantity,
        avgPrice: quantity ? round2(totalValue / quantity) : 0,
        totalValue: round2(totalValue),
        units: [...units].sort((a, b) => a.imei.localeCompare(b.imei)),
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

export function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state || null) as {
    condition?: StockTab;
  } | null;
  const [tab, setTab] = useState<StockTab>(
    locationState?.condition === "USED" ? "USED" : "NEW",
  );
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (locationState?.condition === "USED" || locationState?.condition === "NEW") {
      setTab(locationState.condition);
    }
  }, [locationState?.condition]);

  function openAddPage(prefillGroup: StockGroup | null = null) {
    const state: AddStockLocationState = {
      condition: tab,
      prefill: prefillGroup
        ? {
            platform:
              prefillGroup.platform === "ANDROID" ? "ANDROID" : "IOS",
            mobileName: prefillGroup.productName,
            storage: prefillGroup.storage,
            ram: prefillGroup.ram,
            color: prefillGroup.color,
          }
        : null,
      supplierId: prefillGroup?.supplierId || null,
      supplierName: prefillGroup?.supplierName || null,
    };
    navigate("/stock/add", { state });
  }

  async function loadStock(condition: StockTab) {
    setLoading(true);
    try {
      const response = await api.listStock(condition);
      setItems(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stock");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedKey(null);
    void loadStock(tab);
  }, [tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.mobileName,
        item.color,
        item.storage,
        item.ram,
        item.imei,
        item.platform,
        item.supplierName || "",
        ...item.suppliers,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const groups = useMemo(() => groupStockByProduct(filtered), [filtered]);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.key === selectedKey) || null,
    [groups, selectedKey],
  );

  const totalQty = filtered.length;
  const totalValue = round2(
    filtered.reduce((sum, item) => sum + (item.purchasePrice || 0), 0),
  );

  async function removeItem(item: StockItem) {
    if (
      !window.confirm(`Remove ${item.mobileName} (${item.imei}) from stock?`)
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

  if (selectedGroup) {
    return (
      <StockProductDetail
        group={selectedGroup}
        condition={tab}
        deletingId={deletingId}
        error={error}
        onBack={() => setSelectedKey(null)}
        onRemove={(unit) => void removeItem(unit)}
        onAdd={() => openAddPage(selectedGroup)}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Stock"
        description="New and second-hand mobiles in the shop."
        action={
          <button
            type="button"
            className="btn-primary"
            onClick={() => openAddPage(null)}
          >
            <Plus className="h-4 w-4" />
            Add mobile
          </button>
        }
      />

      <div className="mb-3 space-y-2">
        <div
          className="grid grid-cols-2 gap-0.5 rounded-lg border border-ink-200 bg-ink-50 p-0.5"
          role="tablist"
          aria-label="Stock type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "NEW"}
            className={
              tab === "NEW"
                ? "inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 px-3 py-2 text-sm font-semibold text-white"
                : "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:bg-white"
            }
            onClick={() => setTab("NEW")}
          >
            <Smartphone className="h-3.5 w-3.5" />
            New
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "USED"}
            className={
              tab === "USED"
                ? "inline-flex items-center justify-center gap-1.5 rounded-md bg-ink-900 px-3 py-2 text-sm font-semibold text-white"
                : "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:bg-white"
            }
            onClick={() => setTab("USED")}
          >
            <Package className="h-3.5 w-3.5" />
            Second hand
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className="field h-9 py-1.5 pl-8 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, IMEI, supplier…"
            aria-label="Search stock"
          />
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
              ? "No matching phones"
              : tab === "NEW"
                ? "No new mobiles yet"
                : "No second-hand mobiles yet"
          }
          description={
            query.trim()
              ? "Try a different search."
              : "Tap Add mobile to record a purchase into stock."
          }
        />
      ) : (
        <div className="overflow-x-auto border border-ink-300 bg-white">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-ink-100 text-ink-700">
                <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                  Product name
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Qty
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Avg price
                </th>
                <th className="border-b border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Total value
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={group.key}
                  className="cursor-pointer odd:bg-white even:bg-ink-50/60 hover:bg-tide-50/70"
                  onClick={() => setSelectedKey(group.key)}
                >
                  <td className="border-b border-r border-ink-200 px-2 py-1 font-medium text-ink-900">
                    {formatProductLabel(group)}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1 text-right tabular-nums text-ink-800">
                    {group.quantity}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1 text-right tabular-nums text-ink-800">
                    {formatINR(group.avgPrice)}
                  </td>
                  <td className="border-b border-ink-200 px-2 py-1 text-right tabular-nums text-ink-800">
                    {formatINR(group.totalValue)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 font-semibold text-ink-900">
                <td className="border-t border-r border-ink-300 px-2 py-1.5">
                  Total
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {totalQty}
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right text-ink-400">
                  —
                </td>
                <td className="border-t border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {formatINR(totalValue)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="border-t border-ink-200 px-2 py-1 text-[11px] text-ink-400">
            Click a product for unit details. Manage suppliers under{" "}
            <Link to="/suppliers" className="text-tide-600 underline hover:text-tide-700">
              Suppliers
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

function StockProductDetail({
  group,
  condition,
  deletingId,
  error,
  onBack,
  onRemove,
  onAdd,
}: {
  group: StockGroup;
  condition: StockTab;
  deletingId: string | null;
  error: string | null;
  onBack: () => void;
  onRemove: (unit: StockItem) => void;
  onAdd: () => void;
}) {
  const title = formatProductLabel(group);
  const units = [...group.units].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const isUsed = condition === "USED";
  const [histories, setHistories] = useState<Record<string, StockHistory>>({});
  const [expandedImei, setExpandedImei] = useState<string | null>(null);

  async function toggleHistory(unit: StockItem) {
    if (expandedImei === unit.id) {
      setExpandedImei(null);
      return;
    }
    setExpandedImei(unit.id);
    if (histories[unit.id]) return;
    try {
      const { data } = await api.stockHistory(unit.id);
      setHistories((current) => ({ ...current, [unit.id]: data }));
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-tide-600 hover:text-tide-700 hover:underline"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to stock
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-semibold leading-snug text-ink-900 sm:text-2xl">
              {title}
            </h1>
            <span
              className={
                isUsed
                  ? "rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ember-500"
                  : "rounded border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-tide-700"
              }
            >
              {isUsed ? "Second hand" : "New"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {group.quantity} unit{group.quantity === 1 ? "" : "s"} · Avg{" "}
            {formatINR(group.avgPrice)} · Total {formatINR(group.totalValue)}
            {group.supplierName ? ` · ${group.supplierName}` : ""}
          </p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add same mobile
        </button>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto border border-ink-300 bg-white">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-ink-100 text-ink-700">
              <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                Purchase date
              </th>
              <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                Supplier name
              </th>
              <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                Price
              </th>
              <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                IMEI
              </th>
              <th className="border-b border-ink-300 px-2 py-1.5 text-right font-semibold">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const history = histories[unit.id];
              const open = expandedImei === unit.id;
              return (
                <Fragment key={unit.id}>
                  <tr className="odd:bg-white even:bg-ink-50/60">
                    <td className="border-b border-r border-ink-200 px-2 py-1.5 text-ink-800">
                      {formatPurchaseDate(unit.createdAt)}
                    </td>
                    <td className="border-b border-r border-ink-200 px-2 py-1.5 text-ink-800">
                      {unit.supplierName || unit.suppliers[0] || "—"}
                      {unit.supplierId ? (
                        <>
                          {" "}
                          <Link
                            to={`/suppliers/${unit.supplierId}`}
                            className="text-xs text-tide-600 underline hover:text-tide-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ledger
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums text-ink-800">
                      {formatINR(unit.purchasePrice)}
                    </td>
                    <td className="border-b border-r border-ink-200 px-2 py-1.5 font-mono text-ink-800">
                      <button
                        type="button"
                        className="text-left font-mono text-tide-600 hover:text-tide-700 hover:underline"
                        onClick={() => void toggleHistory(unit)}
                        title="IMEI history"
                      >
                        {unit.imei}
                      </button>
                    </td>
                    <td className="border-b border-ink-200 px-2 py-1.5 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50"
                        disabled={deletingId === unit.id}
                        onClick={() => onRemove(unit)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === unit.id ? "…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-tide-50/40">
                      <td
                        colSpan={5}
                        className="border-b border-ink-200 px-3 py-2 text-xs text-ink-700"
                      >
                        {!history ? (
                          <span>Loading history…</span>
                        ) : (
                          <div className="space-y-1">
                            <p>
                              <span className="font-semibold">Purchased</span>{" "}
                              {formatPurchaseDate(
                                history.purchase?.purchaseDate ||
                                  unit.createdAt,
                              )}{" "}
                              from{" "}
                              {history.supplier?.name ||
                                unit.supplierName ||
                                unit.suppliers[0] ||
                                "—"}{" "}
                              @ {formatINR(unit.purchasePrice)}
                            </p>
                            {history.sale ? (
                              <p>
                                <span className="font-semibold">Sold</span>{" "}
                                {formatPurchaseDate(history.sale.billDate)} on{" "}
                                <Link
                                  to={`/bills/${history.sale.billId}`}
                                  className="font-mono text-tide-600 underline hover:text-tide-700"
                                >
                                  {history.sale.invoiceNumber}
                                </Link>{" "}
                                → {history.sale.customerName} (
                                {history.sale.customerPhone})
                              </p>
                            ) : (
                              <p className="text-ink-500">
                                Still in stock (not sold yet).
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-ink-200 px-2 py-1 text-[11px] text-ink-400">
          Click an IMEI to see purchase → sale history.
        </p>
      </div>
    </div>
  );
}
