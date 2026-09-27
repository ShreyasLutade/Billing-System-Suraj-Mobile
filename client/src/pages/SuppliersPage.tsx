import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowDownUp, ChevronDown, Phone, Search, Smartphone } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { ImeiScanFieldButton } from "../components/BarcodeImeiScanner";
import {
  EmptyState,
  LoadingBlock,
  PageHeader,
  SearchClearButton,
} from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { useSessionState } from "../hooks/useSessionState";
import { ApiError, api, formatINR, formatStockUnitId } from "../lib/api";
import {
  matchesElasticFields,
  normalizeSearchText,
} from "../lib/elasticSearch";
import { fromState } from "../lib/navMemory";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { StockImeiTrace, Supplier, SupplierMobile } from "../types";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function looksLikeImei(value: string) {
  return digitsOnly(value).length >= 8;
}

function stockSpecLabel(stock: StockImeiTrace["stock"]) {
  const parts = [
    stock.mobileName,
    stock.color,
    stock.storage ? formatCapacityLabel(stock.storage) : "",
    stock.platform === "ANDROID" && stock.ram
      ? formatCapacityLabel(stock.ram)
      : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function mobileSpecLabel(m: SupplierMobile) {
  return [
    m.storage ? formatCapacityLabel(m.storage) : "",
    m.platform === "ANDROID" && m.ram ? formatCapacityLabel(m.ram) : "",
    m.color,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Strict model match on the mobile name only (not colour/storage): every query
 * word must start a word of the name, and numbers must match whole
 * ("iphone 12" matches "iPhone 12 Pro" but not "iPhone 13"; "red" matches
 * "Redmi" but not a red iPhone).
 */
function matchesModel(m: SupplierMobile, query: string) {
  const words = normalizeSearchText(m.mobileName).split(" ");
  const parts = normalizeSearchText(query).split(" ").filter(Boolean);
  return parts.every((q, i) =>
    // A number still being typed (last word) matches as a prefix, so
    // "iphone 1" lists 11/12/13… and "iphone 12" narrows to the 12 only.
    /^\d+$/.test(q) && i < parts.length - 1
      ? words.includes(q)
      : words.some((w) => w.startsWith(q)),
  );
}

/** Model search kicks in from 3 characters (e.g. "i14", "iphone 14"). */
function isModelQuery(query: string) {
  return normalizeSearchText(query).replace(/\s+/g, "").length >= 3;
}

type SortKey = "latest" | "name" | "outstanding" | "purchased" | "stock";
type SortDir = 1 | -1;

const SORT_FIELD_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "latest", label: "Latest" },
  { key: "name", label: "Name" },
  { key: "outstanding", label: "Outstanding" },
  { key: "purchased", label: "Purchased" },
  { key: "stock", label: "In stock" },
];

/** Sort keys based on purchase amounts — admin only. */
const COST_SORT_KEYS: SortKey[] = ["outstanding", "purchased"];

function supplierSortLabel(key: SortKey, dir: SortDir) {
  if (key === "latest") return dir === -1 ? "Newest" : "Oldest";
  if (key === "name") return dir === 1 ? "A → Z" : "Z → A";
  const base =
    key === "outstanding"
      ? "Outstanding"
      : key === "purchased"
        ? "Purchased"
        : "In stock";
  return `${base} ${dir === -1 ? "↓" : "↑"}`;
}

function compareSuppliers(a: Supplier, b: Supplier, key: SortKey, dir: SortDir) {
  if (key === "latest") {
    const ax = new Date(a.createdAt).getTime() || 0;
    const bx = new Date(b.createdAt).getTime() || 0;
    return (ax - bx) * dir;
  }
  if (key === "name") {
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * dir
    );
  }
  if (key === "outstanding") return (a.outstanding - b.outstanding) * dir;
  if (key === "purchased") return (a.totalPurchased - b.totalPurchased) * dir;
  return (a.stockAvailable - b.stockAvailable) * dir;
}

/**
 * Hide suppliers with nothing left — no stock, nothing purchased, and no money
 * purchased/paid/outstanding (e.g. after every mobile under them was deleted).
 * Anyone with an amount still recorded stays visible so dues aren’t hidden.
 */
function supplierHasActivity(s: Supplier) {
  const qtyPurchased = s.stockPurchased ?? s.stockAvailable + s.stockSold;
  return (
    s.stockAvailable > 0 ||
    qtyPurchased > 0 ||
    Math.abs(s.totalPurchased) > 0.005 ||
    Math.abs(s.totalPaid) > 0.005 ||
    Math.abs(s.outstanding) > 0.005
  );
}

export function SuppliersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useSessionState("suppliers.query", "");
  const { isAdmin } = useAuth();
  const [storedSortKey, setSortKey] = useSessionState<SortKey>(
    "suppliers.sortKey",
    "latest",
  );
  // Staff never see purchase amounts, so they can't sort by them either.
  const sortKey: SortKey =
    !isAdmin && COST_SORT_KEYS.includes(storedSortKey) ? "latest" : storedSortKey;
  const sortFieldOptions = isAdmin
    ? SORT_FIELD_OPTIONS
    : SORT_FIELD_OPTIONS.filter((option) => !COST_SORT_KEYS.includes(option.key));
  const [sortDir, setSortDir] = useSessionState<SortDir>("suppliers.sortDir", -1);
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const [imeiTrace, setImeiTrace] = useState<StockImeiTrace | null>(null);
  const [imeiLoading, setImeiLoading] = useState(false);
  const [imeiError, setImeiError] = useState<string | null>(null);
  const imeiAbortRef = useRef<AbortController | null>(null);
  const [mobiles, setMobiles] = useState<SupplierMobile[] | null>(null);
  const [mobilesError, setMobilesError] = useState<string | null>(null);
  const mobilesRequested = useRef(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.listSuppliers();
      setSuppliers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!sortOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (
        sortWrapRef.current &&
        !sortWrapRef.current.contains(event.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  useEffect(() => {
    imeiAbortRef.current?.abort();
    imeiAbortRef.current = null;

    if (!looksLikeImei(query)) {
      setImeiTrace(null);
      setImeiError(null);
      setImeiLoading(false);
      return;
    }

    const imei = digitsOnly(query);
    const controller = new AbortController();
    imeiAbortRef.current = controller;
    setImeiLoading(true);
    setImeiError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data } = await api.traceStockByImei(imei, controller.signal);
          if (controller.signal.aborted) return;
          setImeiTrace(data);
          setImeiError(null);
        } catch (err) {
          if (controller.signal.aborted) return;
          setImeiTrace(null);
          if (err instanceof ApiError && err.status === 404) {
            setImeiError("No mobile found for this IMEI");
          } else {
            setImeiError(
              err instanceof Error ? err.message : "Could not look up IMEI",
            );
          }
        } finally {
          if (!controller.signal.aborted) setImeiLoading(false);
        }
      })();
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const imeiMode = looksLikeImei(query);
  const modelMode = !imeiMode && isModelQuery(query);

  // Load every purchased mobile once, the first time a model is searched.
  useEffect(() => {
    if (!modelMode || mobilesRequested.current) return;
    mobilesRequested.current = true;
    void (async () => {
      try {
        const { data } = await api.listSupplierMobiles();
        setMobiles(data);
        setMobilesError(null);
      } catch (err) {
        mobilesRequested.current = false;
        setMobilesError(
          err instanceof Error ? err.message : "Could not load mobiles",
        );
      }
    })();
  }, [modelMode]);

  const mobileMatches = useMemo(() => {
    if (!modelMode || !mobiles) return [];
    return mobiles
      .filter((m) => matchesModel(m, query))
      .sort(
        (a, b) =>
          new Date(b.purchaseDate).getTime() -
          new Date(a.purchaseDate).getTime(),
      );
  }, [mobiles, query, modelMode]);
  const mobilesLoading = modelMode && !mobiles && !mobilesError;

  const filtered = useMemo(() => {
    if (imeiMode) return [];
    const active = suppliers.filter(supplierHasActivity);
    const matched = !query.trim()
      ? active
      : active.filter((s) =>
          matchesElasticFields([s.name, s.phone], query),
        );
    return [...matched].sort((a, b) =>
      compareSuppliers(a, b, sortKey, sortDir),
    );
  }, [suppliers, query, sortKey, sortDir, imeiMode]);

  const suppliersReveal = useInfiniteReveal(
    filtered,
    `${query}|${sortKey}|${sortDir}|${filtered.length}`,
  );

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        purchased: acc.purchased + s.totalPurchased,
        paid: acc.paid + s.totalPaid,
        outstanding: acc.outstanding + s.outstanding,
        stock: acc.stock + s.stockAvailable,
        qty: acc.qty + (s.stockPurchased ?? s.stockAvailable + s.stockSold),
      }),
      { purchased: 0, paid: 0, outstanding: 0, stock: 0, qty: 0 },
    );
  }, [filtered]);

  function applyImei(imei: string) {
    const cleaned = digitsOnly(imei);
    if (!cleaned) return;
    setQuery(cleaned);
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Supplier ledger — purchases, payments, and outstanding."
      />

      <div className="tb-toolbar">
        <div className="tb-searchrow">
          <div className="tb-search !pr-1.5">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplier, model or IMEI…"
              aria-label="Search supplier, model or IMEI"
              className="font-mono tracking-wide"
              inputMode="search"
              autoComplete="off"
            />
            <SearchClearButton
              visible={Boolean(query)}
              onClear={() => setQuery("")}
            />
            <ImeiScanFieldButton onScan={applyImei} />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {imeiMode ? (
        <div className="mb-4 flex justify-center md:justify-start">
          <div className="w-full max-w-[420px] md:max-w-xl lg:max-w-2xl">
            {imeiLoading ? (
              <LoadingBlock label="Looking up IMEI…" />
            ) : imeiError ? (
              <EmptyState title={imeiError} description="Try another IMEI." />
            ) : imeiTrace ? (
              <ImeiTraceCard trace={imeiTrace} showCost={isAdmin} />
            ) : null}
          </div>
        </div>
      ) : null}

      {modelMode ? (
        mobilesLoading ? (
          <LoadingBlock label="Finding mobiles…" />
        ) : mobilesError ? (
          <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
            {mobilesError}
          </div>
        ) : mobileMatches.length ? (
          <MobileMatchesTable
            mobiles={mobileMatches}
            query={query}
            showCost={isAdmin}
          />
        ) : null
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading suppliers…" />
      ) : imeiMode ? null : filtered.length === 0 ? (
        modelMode && (mobilesLoading || mobileMatches.length) ? null : (
        <EmptyState
          title={
            query.trim() ? "No matching suppliers or mobiles" : "No suppliers yet"
          }
          description="Suppliers appear here after you add stock from the Stock page. Search a model (e.g. iPhone 14) or scan an IMEI to trace units."
        />
        )
      ) : (
        <>
          <div className="mb-2.5 flex items-center justify-between gap-3 px-1 text-[13px] text-ink-500">
            <span>
              Showing{" "}
              <b className="font-semibold text-ink-900">{filtered.length}</b>{" "}
              supplier{filtered.length === 1 ? "" : "s"}
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
                aria-label={`Sort: ${supplierSortLabel(sortKey, sortDir)}`}
                title={`Sort: ${supplierSortLabel(sortKey, sortDir)}`}
                onClick={() => setSortOpen((open) => !open)}
              >
                <ArrowDownUp
                  className="h-4 w-4 text-ink-500 sm:h-[15px] sm:w-[15px] sm:text-ink-300"
                  strokeWidth={2}
                />
                <span className="hidden sm:inline">
                  Sort:{" "}
                  <b className="font-semibold text-ink-900">
                    {supplierSortLabel(sortKey, sortDir)}
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
                  aria-label="Sort suppliers"
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
                    {sortFieldOptions.map((option) => {
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
                              ? "bg-[#F4F7FA] font-semibold text-ink-900"
                              : "font-medium text-ink-600 hover:bg-[#F7F8FA] hover:text-ink-900",
                          )}
                          onClick={() => {
                            setSortKey(option.key);
                            if (option.key === "latest") setSortDir(-1);
                          }}
                        >
                          {option.label}
                          {on ? (
                            <span className="text-[11px] font-semibold text-tide-600">
                              On
                            </span>
                          ) : null}
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
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Phone</th>
                    <th className="text-right">In stock</th>
                    <th className="text-right">Qty purchased</th>
                    {isAdmin ? (
                      <>
                        <th className="text-right">Purchased</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Outstanding</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {suppliersReveal.visibleItems.map((s) => (
                    <tr
                      key={s.id}
                      className="ledger-row-click"
                      onClick={() =>
                        navigate(`/suppliers/${s.id}`, {
                          state: fromState(location),
                        })
                      }
                    >
                      <td className="font-semibold whitespace-normal text-ink-900">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {s.name}
                          {s.hasExchangeIntake ? (
                            <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                              Exchange
                            </span>
                          ) : null}
                          {s.hasReturnIntake ? (
                            <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                              Return
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular-nums text-ink-500">
                        {s.phone || "—"}
                      </td>
                      <td className="text-right tabular-nums text-ink-500">
                        {s.stockAvailable}
                      </td>
                      <td className="text-right tabular-nums text-ink-500">
                        {s.stockPurchased ?? s.stockAvailable + s.stockSold}
                      </td>
                      {isAdmin ? (
                        <>
                          <td className="text-right tabular-nums text-ink-500">
                            {formatINR(s.totalPurchased)}
                          </td>
                          <td className="text-right tabular-nums text-ink-500">
                            {formatINR(s.totalPaid)}
                          </td>
                          <td className="text-right tabular-nums font-bold text-ink-900">
                            {formatINR(s.outstanding)}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="text-right tabular-nums">{totals.stock}</td>
                    <td className="text-right tabular-nums">{totals.qty}</td>
                    {isAdmin ? (
                      <>
                        <td className="text-right tabular-nums">
                          {formatINR(totals.purchased)}
                        </td>
                        <td className="text-right tabular-nums">
                          {formatINR(totals.paid)}
                        </td>
                        <td className="text-right tabular-nums">
                          {formatINR(totals.outstanding)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                </tfoot>
              </table>
            </div>
            <LoadMoreSentinel
              sentinelRef={suppliersReveal.sentinelRef}
              hasMore={suppliersReveal.hasMore}
              loadingMore={suppliersReveal.loadingMore}
              totalCount={suppliersReveal.totalCount}
              showEnd={false}
            />
            <p className="ledger-note">
              Click a supplier to open the ledger. Or{" "}
              <Link
                to="/stock"
                className="font-medium text-tide-600 hover:underline"
              >
                go to Stock
              </Link>
              .
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Every purchase of the searched model, with the supplier it came from. */
function MobileMatchesTable({
  mobiles,
  query,
  showCost,
}: {
  mobiles: SupplierMobile[];
  query: string;
  showCost: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const reveal = useInfiniteReveal(mobiles, `${query}|${mobiles.length}`);
  const supplierCount = new Set(
    mobiles.map((m) => m.supplier?.id ?? "none"),
  ).size;
  const totalCost = mobiles.reduce((sum, m) => sum + (m.purchasePrice ?? 0), 0);

  return (
    <div className="mb-5">
      <div className="mb-2.5 px-1 text-[13px] text-ink-500">
        <b className="font-semibold text-ink-900">{mobiles.length}</b> mobile
        {mobiles.length === 1 ? "" : "s"} matching “{query.trim()}” from{" "}
        <b className="font-semibold text-ink-900">{supplierCount}</b> supplier
        {supplierCount === 1 ? "" : "s"}
      </div>
      <div className="ledger-card">
        <div className="ledger-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Mobile</th>
                <th>IMEI / Serial</th>
                <th>Purchase date</th>
                <th>Supplier</th>
                {showCost ? <th className="text-right">Purchase price</th> : null}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reveal.visibleItems.map((m) => {
                const sold = m.status === "SOLD";
                // Open the purchase this unit came in on (the mobile detail
                // page), falling back to the supplier ledger.
                const target = m.purchase
                  ? `/suppliers/${m.purchase.supplierId}/purchases/${m.purchase.id}`
                  : m.supplier
                    ? `/suppliers/${m.supplier.id}`
                    : null;
                return (
                  <tr
                    key={m.id}
                    className={target ? "ledger-row-click" : undefined}
                    onClick={() => {
                      if (!target) return;
                      navigate(target, {
                        state: { ...fromState(location), highlightStockId: m.id },
                      });
                    }}
                  >
                    <td className="whitespace-normal">
                      <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-ink-900">
                        {m.mobileName}
                        {m.condition === "USED" ? (
                          <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                            Old
                          </span>
                        ) : null}
                      </span>
                      {mobileSpecLabel(m) ? (
                        <span className="block text-[12px] text-ink-400">
                          {mobileSpecLabel(m)}
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-[12.5px] tabular-nums text-ink-500">
                      {formatStockUnitId(m)}
                    </td>
                    <td className="tabular-nums text-ink-500">
                      {format(new Date(m.purchaseDate), "dd MMM yyyy")}
                    </td>
                    <td className="font-semibold text-ink-900">
                      {m.supplier?.name || "—"}
                    </td>
                    {showCost ? (
                      <td className="text-right tabular-nums text-ink-900">
                        {formatINR(m.purchasePrice ?? 0)}
                      </td>
                    ) : null}
                    <td>
                      {sold ? (
                        m.sale ? (
                          <Link
                            to={`/bills/${m.sale.billId}`}
                            state={fromState(location)}
                            className="text-[12.5px] font-semibold text-rose-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Sold · {m.sale.invoiceNumber}
                          </Link>
                        ) : (
                          <span className="text-[12.5px] font-semibold text-rose-600">
                            Sold
                          </span>
                        )
                      ) : (
                        <span className="text-[12.5px] font-semibold text-tide-600">
                          In stock
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {showCost ? (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="text-right tabular-nums">
                    {formatINR(totalCost)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <LoadMoreSentinel
          sentinelRef={reveal.sentinelRef}
          hasMore={reveal.hasMore}
          loadingMore={reveal.loadingMore}
          totalCount={reveal.totalCount}
          showEnd={false}
        />
      </div>
    </div>
  );
}

function formatImeiGroups(imei: string) {
  const digits = digitsOnly(imei);
  if (!digits) return "—";
  return digits.replace(/(\d{6})(?=\d)/g, "$1 ").trim();
}

function formatPhoneGroups(phone: string) {
  const digits = digitsOnly(phone);
  if (!digits) return "No phone";
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return phone;
}

function ImeiTraceCard({
  trace,
  showCost,
}: {
  trace: StockImeiTrace;
  showCost: boolean;
}) {
  const location = useLocation();
  const { stock, supplier, purchaseDate, costPrice, sale } = trace;
  const sold = stock.status === "SOLD" || Boolean(sale);
  const isUsed = stock.condition === "USED";
  const supplierInitial = (supplier?.name?.trim()?.[0] || "?").toUpperCase();
  const supplierPhoneDigits = supplier?.phone ? digitsOnly(supplier.phone) : "";
  const hasSalePrice = Boolean(sale && sale.sellingPrice > 0);

  return (
    <article className="relative overflow-hidden rounded-[22px] border border-[#E8ECF2] bg-white shadow-[0_10px_28px_rgba(16,25,40,0.08)] dark:border-ink-100 dark:bg-surface-elevated dark:shadow-soft">
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-[5px] bg-[#22C55E]"
      />

      <div className="pl-[5px]">
        <div className="flex gap-3.5 px-4 pb-4 pt-4 sm:gap-4 sm:px-5 sm:pt-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[#EEF1F6] text-ink-500 dark:bg-surface-muted sm:h-14 sm:w-14 sm:rounded-2xl">
            <Smartphone className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
              Imei trace
            </p>
            <h2 className="mt-1 font-display text-[1.15rem] font-semibold leading-snug text-ink-900 sm:text-xl">
              {stockSpecLabel(stock)}
            </h2>
            <p className="mt-1.5 font-mono text-[13px] tabular-nums tracking-wide text-ink-400 sm:text-sm">
              {formatImeiGroups(stock.imei || "")}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                  isUsed
                    ? "bg-orange-50 text-ember-500"
                    : "bg-[#E8F8EF] text-[#15803D]",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    isUsed ? "bg-ember-500" : "bg-[#22C55E]",
                  )}
                />
                {isUsed ? "Old" : "New"}
              </span>
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                  sold
                    ? "bg-rose-50 text-rose-600"
                    : "bg-[#E8F1FE] text-tide-600",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    sold ? "bg-rose-500" : "bg-tide-500",
                  )}
                />
                {sold ? "Sold" : "In stock"}
              </span>
            </div>
          </div>
        </div>

        {supplier ? (
          <div className="mx-4 flex items-center gap-3 border-t border-[#EEF1F5] py-3.5 sm:mx-5">
            <Link
              to={`/suppliers/${supplier.id}`}
              state={fromState(location)}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF1F6] font-display text-base font-semibold text-ink-900 dark:bg-surface-muted">
                {supplierInitial}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                  Supplier
                </p>
                <p className="truncate text-[15px] font-semibold text-ink-900">
                  {supplier.name}
                </p>
                <p className="text-[13px] tabular-nums text-ink-400">
                  {formatPhoneGroups(supplier.phone || "")}
                </p>
              </div>
            </Link>
            {supplierPhoneDigits ? (
              <a
                href={`tel:${supplierPhoneDigits}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#E8F8EF] text-[#15803D] transition hover:bg-[#DCF5E7]"
                aria-label={`Call ${supplier.name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <Phone className="h-[18px] w-[18px]" strokeWidth={2.25} />
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          {showCost ? (
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[#F3F5F8] px-4 py-3.5 dark:bg-surface-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Cost price
              </p>
              <p className="font-display text-xl font-semibold tabular-nums tracking-tight text-ink-900 sm:text-2xl">
                {formatINR(costPrice)}
              </p>
            </div>
          ) : null}

          <div className="rounded-[16px] border border-[#EEF1F5] px-4 dark:border-ink-100">
            <div className="flex items-center justify-between gap-3 border-b border-[#EEF1F5] py-3.5 dark:border-ink-100">
              <span className="text-[13px] text-ink-400">Purchase date</span>
              <span className="text-[13px] font-semibold tabular-nums text-ink-900 sm:text-sm">
                {format(new Date(purchaseDate), "dd MMM yyyy")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-[#EEF1F5] py-3.5 dark:border-ink-100">
              <span className="text-[13px] text-ink-400">Selling price</span>
              {hasSalePrice ? (
                <span className="text-[13px] font-semibold tabular-nums text-ink-900 sm:text-sm">
                  {formatINR(sale!.sellingPrice)}
                </span>
              ) : sold ? (
                <span className="text-[13px] text-ink-400">—</span>
              ) : (
                <span className="rounded-full bg-[#FFF1E8] px-2.5 py-1 text-[12px] font-semibold text-[#C2410C]">
                  Not sold yet
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 py-3.5">
              <span className="text-[13px] text-ink-400">Linked bill</span>
              {sale ? (
                <Link
                  to={`/bills/${sale.billId}`}
                  state={fromState(location)}
                  className="max-w-[60%] truncate text-right text-[13px] font-semibold text-tide-600 underline-offset-2 hover:underline sm:text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  {sale.invoiceNumber}
                </Link>
              ) : (
                <span className="text-[13px] text-ink-400">—</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
