import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
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

      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="field h-9 py-1.5 pl-8 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search supplier…"
        />
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
        <div className="overflow-x-auto border border-ink-300 bg-white">
          <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-ink-100 text-ink-700">
                <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                  Supplier
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 font-semibold">
                  Phone
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  In stock
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Qty purchased
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Purchased
                </th>
                <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Paid
                </th>
                <th className="border-b border-ink-300 px-2 py-1.5 text-right font-semibold">
                  Outstanding
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer odd:bg-white even:bg-ink-50/60 hover:bg-tide-50/70"
                  onClick={() => navigate(`/suppliers/${s.id}`)}
                >
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 font-medium text-ink-900">
                    {s.name}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 tabular-nums text-ink-700">
                    {s.phone || "—"}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums">
                    {s.stockAvailable}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums">
                    {s.stockPurchased ?? s.stockAvailable + s.stockSold}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums">
                    {formatINR(s.totalPurchased)}
                  </td>
                  <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums">
                    {formatINR(s.totalPaid)}
                  </td>
                  <td className="border-b border-ink-200 px-2 py-1.5 text-right tabular-nums font-semibold text-ink-900">
                    {formatINR(s.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 font-semibold">
                <td
                  className="border-t border-r border-ink-300 px-2 py-1.5"
                  colSpan={2}
                >
                  Total
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {totals.stock}
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {totals.qty}
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {formatINR(totals.purchased)}
                </td>
                <td className="border-t border-r border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {formatINR(totals.paid)}
                </td>
                <td className="border-t border-ink-300 px-2 py-1.5 text-right tabular-nums">
                  {formatINR(totals.outstanding)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="border-t border-ink-200 px-2 py-1 text-[11px] text-ink-400">
            Click a supplier to open the ledger. Or{" "}
            <Link to="/stock" className="text-tide-600 underline hover:text-tide-700">
              go to Stock
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
