import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Package, ReceiptText, Trash2, Truck, Undo2, Wrench } from "lucide-react";
import clsx from "clsx";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import {
  ConfirmModal,
  DangerConfirmModal,
  RECYCLE_BIN_DAYS,
} from "../components/RemoveConfirmModals";
import { api, type RecycleBinEntry } from "../lib/api";

const KIND = {
  BILL: {
    label: "Bill",
    icon: ReceiptText,
    tone: "bg-tide-100 text-tide-600 dark:bg-tide-100/30 dark:text-tide-400",
    restoreText:
      "The bill comes back with its items and payments. Its phones go back to sold.",
  },
  SUPPLIER: {
    label: "Supplier",
    icon: Truck,
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    restoreText:
      "The supplier comes back with all its purchases, payments and stock.",
  },
  STOCK: {
    label: "Stock",
    icon: Package,
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    restoreText:
      "The item goes back in stock on its original purchase, and the purchase total is updated.",
  },
  REPAIR: {
    label: "Repair job",
    icon: Wrench,
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    restoreText: "The repair job and its photos are restored to the tracker.",
  },
} as const;

const HOUR = 60 * 60 * 1000;

/** "5 min ago", "3 h ago", "2 days ago". */
function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} min ago`;
  if (ms < 24 * HOUR) return `${Math.round(ms / HOUR)} h ago`;
  const days = Math.floor(ms / (24 * HOUR));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Time left before an entry is removed for good: "2d 5h", "4h", "35 min". */
function left(iso: string) {
  const ms = Math.max(new Date(iso).getTime() - Date.now(), 0);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} min`;
  const days = Math.floor(ms / (24 * HOUR));
  const hours = Math.floor((ms % (24 * HOUR)) / HOUR);
  return days ? `${days}d ${hours}h` : `${hours}h`;
}

export function RecycleBinPage() {
  const [entries, setEntries] = useState<RecycleBinEntry[]>([]);
  const [days, setDays] = useState(RECYCLE_BIN_DAYS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<RecycleBinEntry | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [working, setWorking] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ label: string; path: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, meta } = await api.listRecycleBin();
        if (!active) return;
        setEntries(data);
        setDays(meta.days);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load recycle bin");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The "… is restored" banner hides itself after 3 seconds.
  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => setRestored(null), 3000);
    return () => window.clearTimeout(timer);
  }, [restored]);

  function closeModal() {
    if (working) return;
    setRestoring(null);
    setEmptying(false);
    setModalError(null);
  }

  async function restore(entry: RecycleBinEntry) {
    setWorking(true);
    setModalError(null);
    try {
      const { data } = await api.restoreRecycleBinEntry(entry.id);
      setEntries((current) => current.filter((e) => e.id !== entry.id));
      setRestored({ label: data.label, path: data.path });
      setRestoring(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Could not restore");
    } finally {
      setWorking(false);
    }
  }

  async function emptyBin() {
    setWorking(true);
    setModalError(null);
    try {
      await api.emptyRecycleBin();
      setEntries([]);
      setRestored(null);
      setEmptying(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Could not empty the bin");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Recycle bin"
        description={`Deleted bills, suppliers, stock and repair jobs stay here for ${days} days, then they are removed for good.`}
        action={
          <button
            type="button"
            className="btn-danger whitespace-nowrap"
            onClick={() => {
              setModalError(null);
              setEmptying(true);
            }}
            disabled={loading || entries.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Delete permanently
          </button>
        }
      />

      <AnimatePresence>
        {restored ? (
          <motion.div
            key={restored.path}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <span>
              <b className="font-semibold">{restored.label}</b> is restored.
            </span>
            <Link to={restored.path} className="font-semibold underline underline-offset-2">
              Open
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error ? (
        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <LoadingBlock label="Loading recycle bin…" />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Recycle bin is empty"
          description={`Anything you delete shows up here for ${days} days, so you can undo it.`}
        />
      ) : (
        <ul className="space-y-2.5">
          {entries.map((entry) => {
            const kind = KIND[entry.kind];
            const msLeft = new Date(entry.expiresAt).getTime() - Date.now();
            return (
              <li
                key={entry.id}
                className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-soft dark:border-ink-100 dark:bg-surface sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={clsx(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                      kind.tone,
                    )}
                  >
                    <kind.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                      {kind.label}
                    </p>
                    <p className="truncate font-semibold text-ink-900">{entry.label}</p>
                    {entry.detail ? (
                      <p className="mt-0.5 text-[13px] text-ink-500">{entry.detail}</p>
                    ) : null}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-400">
                      <span>
                        Deleted {ago(entry.deletedAt)}
                        {entry.deletedByName ? ` by ${entry.deletedByName}` : ""}
                      </span>
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 font-medium",
                          msLeft < 12 * HOUR
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-ink-500",
                        )}
                      >
                        <Clock className="h-3 w-3" />
                        Gone for good in {left(entry.expiresAt)}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary shrink-0 whitespace-nowrap"
                  onClick={() => {
                    setModalError(null);
                    setRestoring(entry);
                  }}
                >
                  <Undo2 className="h-4 w-4" />
                  Undo delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AnimatePresence>
        {restoring ? (
          <ConfirmModal
            key="restore"
            title="Undo this delete?"
            subtitle={restoring.label}
            confirmLabel="Restore"
            workingLabel="Restoring…"
            icon={<Undo2 className="h-4 w-4" />}
            working={working}
            error={modalError}
            onCancel={closeModal}
            onConfirm={() => void restore(restoring)}
          >
            <p>{KIND[restoring.kind].restoreText}</p>
          </ConfirmModal>
        ) : null}
        {emptying ? (
          <DangerConfirmModal
            key="empty"
            title="Empty the recycle bin?"
            subtitle={`${entries.length} deleted item${entries.length === 1 ? "" : "s"}`}
            points={["Everything in the bin is removed for good."]}
            confirmLabel="Delete permanently"
            cancelLabel="Keep them"
            working={working}
            error={modalError}
            onCancel={closeModal}
            onConfirm={() => void emptyBin()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
