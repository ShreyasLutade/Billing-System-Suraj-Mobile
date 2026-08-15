import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { api, formatINR } from "../lib/api";
import { matchesElasticFields } from "../lib/elasticSearch";
import type { Supplier } from "../types";

export function SuppliersPage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    if (!query.trim()) return suppliers;
    return suppliers.filter((s) =>
      matchesElasticFields([s.name, s.phone], query),
    );
  }, [suppliers, query]);

  const suppliersReveal = useInfiniteReveal(
    filtered,
    `${query}|${filtered.length}`,
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

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Supplier ledger — purchases, payments, and outstanding."
      />

      <div className="tb-toolbar">
        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplier…"
              aria-label="Search supplier"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading suppliers…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query.trim() ? "No matching suppliers" : "No suppliers yet"}
          description="Suppliers appear here after you add stock from the Stock page."
        />
      ) : (
        <div className="ledger-card">
          <div className="ledger-scroll">
            <table className="ledger-table min-w-[48rem]">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Phone</th>
                  <th className="text-right">In stock</th>
                  <th className="text-right">Qty purchased</th>
                  <th className="text-right">Purchased</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {suppliersReveal.visibleItems.map((s) => (
                  <tr
                    key={s.id}
                    className="ledger-row-click"
                    onClick={() => navigate(`/suppliers/${s.id}`)}
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
                    <td className="text-right tabular-nums text-ink-500">
                      {formatINR(s.totalPurchased)}
                    </td>
                    <td className="text-right tabular-nums text-ink-500">
                      {formatINR(s.totalPaid)}
                    </td>
                    <td className="text-right tabular-nums font-bold text-ink-900">
                      {formatINR(s.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="text-right tabular-nums">{totals.stock}</td>
                  <td className="text-right tabular-nums">{totals.qty}</td>
                  <td className="text-right tabular-nums">
                    {formatINR(totals.purchased)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatINR(totals.paid)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatINR(totals.outstanding)}
                  </td>
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
              className="font-medium text-[#2563EB] hover:underline"
            >
              go to Stock
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
