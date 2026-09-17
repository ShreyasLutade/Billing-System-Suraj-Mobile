import { useEffect, useState } from "react";
import { DatabaseBackup, Download, Mail, Upload } from "lucide-react";
import { BackLink, PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupPage() {
  const [loading, setLoading] = useState(true);
  const [sqlite, setSqlite] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [approxDbBytes, setApproxDbBytes] = useState<number | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("RESTORE DATABASE");
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.backupStatus();
        if (cancelled) return;
        setSqlite(data.sqlite);
        setCanRestore(data.canRestore);
        setApproxDbBytes(data.approxDbBytes);
        setConfirmPhrase(data.confirmPhrase);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load backup status",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendEmailBackup() {
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.sendBackupEmail("all", true);
      if (data.skipped) {
        setMessage(data.message || "Report was skipped.");
      } else {
        setMessage(
          `Emailed Excel${data.dbFilename ? " + .db" : ""} to ${
            data.emailedTo || "configured address"
          }.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to send backup email",
      );
    } finally {
      setSending(false);
    }
  }

  async function downloadLocalBackup() {
    setDownloading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.downloadBackupZip();
      setMessage(
        `Downloaded ${result.filename}${
          result.dbFilename
            ? ` (Excel + ${result.dbFilename})`
            : " (Excel only — SQLite .db not available)"
        }. Save it somewhere safe.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to download backup zip",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function restore() {
    if (!file) {
      setError("Choose a .db or backup .zip file first");
      return;
    }
    if (confirm.trim() !== confirmPhrase) {
      setError(`Type ${confirmPhrase} exactly to confirm`);
      return;
    }

    setRestoring(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.restoreDatabase(file, confirm.trim());
      setMessage(
        data.message ||
          "Database restored. Waiting for server restart — refresh shortly.",
      );
      setTimeout(() => {
        window.location.assign("/login");
      }, 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restore failed");
      setRestoring(false);
    }
  }

  return (
    <div>
      <BackLink to="/" className="mb-4">
        Back
      </BackLink>
      <PageHeader
        eyebrow="Admin"
        title="Backup & restore"
        description="Download a zip (Excel + .db) to keep locally, email the same files, or upload a .db / backup zip to restore."
      />

      {loading ? (
        <div className="glass-panel px-5 py-10 text-sm text-ink-500">
          Loading backup status…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="glass-panel p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-2xl bg-tide-100 p-2.5 text-tide-700 dark:bg-tide-400/15 dark:text-tide-300">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">
                  Save a backup
                </h2>
                <p className="mt-1 text-sm text-ink-500">
                  Download a zip with the full Excel report and the live{" "}
                  <span className="font-medium text-ink-700">.db</span> file, or
                  email the same to the configured report address.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-surface-muted/50">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                  Database
                </dt>
                <dd className="mt-1 font-medium text-ink-900">
                  {sqlite ? "SQLite (.db)" : "Not SQLite"}
                </dd>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-surface-muted/50">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                  Approx. size
                </dt>
                <dd className="mt-1 font-medium text-ink-900">
                  {formatBytes(approxDbBytes)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={downloading}
                onClick={() => void downloadLocalBackup()}
              >
                <Download className="h-4 w-4" />
                {downloading ? "Preparing zip…" : "Download Excel + .db zip"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={sending || !sqlite}
                onClick={() => void sendEmailBackup()}
              >
                <DatabaseBackup className="h-4 w-4" />
                {sending ? "Sending…" : "Email Excel + .db"}
              </button>
            </div>
            {!sqlite ? (
              <p className="mt-3 text-xs text-ink-500">
                Zip still includes Excel. .db email/restore only works with
                SQLite. Postgres deployments keep Excel reports only.
              </p>
            ) : null}
          </section>

          <section className="glass-panel p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-2xl bg-orange-100 p-2.5 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300">
                <Upload className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-ink-900">
                  Restore from backup
                </h2>
                <p className="mt-1 text-sm text-ink-500">
                  Upload a raw{" "}
                  <span className="font-medium text-ink-700">.db</span> or the
                  backup <span className="font-medium text-ink-700">.zip</span>{" "}
                  you downloaded. This overwrites current data. The server
                  restarts after restore.
                </p>
              </div>
            </div>

            <label className="mt-5 block text-sm font-medium text-ink-700">
              Backup file (.db or .zip)
              <input
                type="file"
                accept=".db,.zip,application/zip,application/x-sqlite3,application/octet-stream"
                className="mt-2 block w-full text-sm text-ink-600 file:mr-3 file:rounded-xl file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white dark:file:bg-tide-400 dark:file:text-ink-50"
                disabled={!canRestore || restoring}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setError(null);
                }}
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-ink-700">
              Type <span className="font-mono text-ink-900">{confirmPhrase}</span>{" "}
              to confirm
              <input
                type="text"
                value={confirm}
                disabled={!canRestore || restoring}
                onChange={(event) => setConfirm(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-ink-100 bg-white/80 px-4 py-2.5 text-sm text-ink-900 outline-none ring-tide-400 focus:ring-2 dark:border-white/10 dark:bg-surface-muted/60"
                placeholder={confirmPhrase}
                autoComplete="off"
              />
            </label>

            <button
              type="button"
              className="btn-primary mt-5 bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-400"
              disabled={!canRestore || restoring || !file}
              onClick={() => void restore()}
            >
              <Upload className="h-4 w-4" />
              {restoring ? "Restoring…" : "Restore database"}
            </button>
          </section>
        </div>
      )}

      {message ? (
        <p
          className="mt-4 rounded-2xl border border-tide-200 bg-tide-50 px-4 py-3 text-sm text-tide-900 dark:border-tide-400/30 dark:bg-tide-400/10 dark:text-tide-100"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
