import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import {
  Ban,
  Check,
  KeyRound,
  RotateCcw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  EmptyState,
  LoadingBlock,
  PageHeader,
  SearchClearButton,
} from "../components/ui";
import { api } from "../lib/api";
import type { ManagedUser } from "../types";

/**
 * Admin-only list of every login — shop admins, staff and the repair-only
 * accounts — with block / unblock and setting a new password.
 *
 * Passwords are bcrypt hashes on the server, so none of them can be shown;
 * the admin can only replace one.
 */

/**
 * Logins kept out of this list — the developer account, which isn't one of
 * the shop's own people. It still works for signing in.
 */
const HIDDEN_PHONES = new Set(["7038006342"]);

/** Admins can't be blocked — only staff and the repair-desk accounts. */
function canBlock(user: ManagedUser) {
  return user.role !== "ADMIN" || Boolean(user.repairShop);
}

/** Repair counters, matching server/src/lib/repairShops. */
const REPAIR_SHOP_LABEL: Record<string, string> = {
  NX: "Babu Mobile NX",
  LK: "Luckey",
};

function formatJoined(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ManageUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [passwordFor, setPasswordFor] = useState<ManagedUser | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listUsers();
      setUsers(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const { admins, staff, repair } = useMemo(() => {
    const term = query.trim().toLowerCase();
    const visible = users.filter((user) => !HIDDEN_PHONES.has(user.phone));
    const matches = term
      ? visible.filter(
          (user) =>
            user.name.toLowerCase().includes(term) || user.phone.includes(term),
        )
      : visible;

    // Repair-only accounts run their own counter — keep them apart.
    const repairOnly = matches.filter((user) => Boolean(user.repairShop));
    const shopUsers = matches.filter((user) => !user.repairShop);

    return {
      admins: shopUsers.filter((user) => user.role === "ADMIN"),
      staff: shopUsers.filter((user) => user.role === "STAFF"),
      repair: repairOnly,
    };
  }, [users, query]);

  async function toggleBlocked(user: ManagedUser) {
    setBusyId(user.id);
    setRowError(null);
    try {
      const response = await api.setUserBlocked(user.id, !user.blocked);
      setUsers((prev) =>
        prev.map((row) => (row.id === user.id ? response.data : row)),
      );
      setToast(
        `${user.name} ${response.data.blocked ? "blocked" : "unblocked"}`,
      );
    } catch (err) {
      setRowError({
        id: user.id,
        message:
          err instanceof Error ? err.message : "Could not update this account",
      });
    } finally {
      setBusyId(null);
    }
  }

  const addButton = (
    <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
      <UserPlus className="h-4 w-4" />
      Add user
    </button>
  );

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Access" title="Manage users" action={addButton} />
        <LoadingBlock label="Loading users…" />
      </div>
    );
  }

  // Count only the logins this page shows, so hiding one doesn't read as
  // "no users".
  const visibleCount = users.filter(
    (user) => !HIDDEN_PHONES.has(user.phone),
  ).length;
  const nothingMatched =
    visibleCount > 0 && !admins.length && !staff.length && !repair.length;

  return (
    <div>
      <PageHeader eyebrow="Access" title="Manage users" action={addButton} />

      <div className="tb-toolbar">
        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or number"
              aria-label="Search users"
            />
            <SearchClearButton
              visible={Boolean(query)}
              onClear={() => setQuery("")}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="glass-panel mb-3 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-rose-700">{error}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load()}
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
        </div>
      ) : null}

      {!visibleCount && !error ? (
        <EmptyState
          title="No users yet"
          description="Logins created for this shop will appear here."
        />
      ) : null}

      {nothingMatched ? (
        <EmptyState
          title="No match"
          description="No user matches that name or number."
        />
      ) : null}

      <UserSection
        title="Admins"
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        users={admins}
        meId={me?.id}
        busyId={busyId}
        rowError={rowError}
        onToggleBlocked={toggleBlocked}
        onSetPassword={setPasswordFor}
      />

      <UserSection
        title="Staff"
        icon={<Users className="h-3.5 w-3.5" />}
        users={staff}
        meId={me?.id}
        busyId={busyId}
        rowError={rowError}
        onToggleBlocked={toggleBlocked}
        onSetPassword={setPasswordFor}
      />

      <UserSection
        title="Repair desk only"
        icon={<Wrench className="h-3.5 w-3.5" />}
        users={repair}
        meId={me?.id}
        busyId={busyId}
        rowError={rowError}
        onToggleBlocked={toggleBlocked}
        onSetPassword={setPasswordFor}
      />

      <AnimatePresence>
        {addOpen ? (
          <AddUserModal
            onClose={() => setAddOpen(false)}
            onDone={(created) => {
              setAddOpen(false);
              setUsers((prev) => [...prev, created]);
              setToast(`${created.name} added`);
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {passwordFor ? (
          <SetPasswordModal
            user={passwordFor}
            onClose={() => setPasswordFor(null)}
            onDone={(name) => {
              setPasswordFor(null);
              setToast(`Password updated for ${name}`);
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div
            className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <p className="flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2.5 text-sm font-medium text-white shadow-lift">
              <Check className="h-4 w-4 shrink-0" />
              {toast}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function UserSection({
  title,
  icon,
  users,
  meId,
  busyId,
  rowError,
  onToggleBlocked,
  onSetPassword,
}: {
  title: string;
  icon: React.ReactNode;
  users: ManagedUser[];
  meId?: string;
  busyId: string | null;
  rowError: { id: string; message: string } | null;
  onToggleBlocked: (user: ManagedUser) => void;
  onSetPassword: (user: ManagedUser) => void;
}) {
  if (!users.length) return null;

  return (
    <section className="mb-4">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
        {icon}
        {title}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600 dark:bg-white/10 dark:text-ink-300">
          {users.length}
        </span>
      </h2>

      <div className="glass-panel divide-y divide-ink-100 overflow-hidden dark:divide-white/10">
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isMe={user.id === meId}
            busy={busyId === user.id}
            error={rowError?.id === user.id ? rowError.message : null}
            onToggleBlocked={() => onToggleBlocked(user)}
            onSetPassword={() => onSetPassword(user)}
          />
        ))}
      </div>
    </section>
  );
}

function UserRow({
  user,
  isMe,
  busy,
  error,
  onToggleBlocked,
  onSetPassword,
}: {
  user: ManagedUser;
  isMe: boolean;
  busy: boolean;
  error: string | null;
  onToggleBlocked: () => void;
  onSetPassword: () => void;
}) {
  const joined = formatJoined(user.createdAt);
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  const shopLabel = user.repairShop
    ? REPAIR_SHOP_LABEL[user.repairShop] || user.repairShop
    : null;

  return (
    <div className={clsx("px-3.5 py-3", user.blocked && "opacity-70")}>
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold",
            user.blocked
              ? "bg-rose-50 text-rose-500 dark:bg-rose-500/15"
              : user.role === "ADMIN"
                ? "bg-tide-100 text-tide-600 dark:bg-tide-100/25 dark:text-tide-400"
                : "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300",
          )}
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold text-ink-900">
              {user.name}
            </span>
            {isMe ? <Pill tone="neutral">You</Pill> : null}
            {user.role === "ADMIN" ? <Pill tone="tide">Admin</Pill> : null}
            {shopLabel ? <Pill tone="neutral">{shopLabel}</Pill> : null}
            {user.blocked ? <Pill tone="rose">Blocked</Pill> : null}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-ink-500">
            {user.phone}
            {joined ? ` · joined ${joined}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex gap-2 pl-[52px]">
        <button
          type="button"
          className="btn-secondary flex-1 whitespace-nowrap"
          onClick={onSetPassword}
          disabled={busy}
        >
          <KeyRound className="h-4 w-4" />
          Set password
        </button>
        {isMe || !canBlock(user) ? null : (
          <button
            type="button"
            className={clsx(
              "flex-1 whitespace-nowrap",
              user.blocked ? "btn-secondary" : "btn-danger",
            )}
            onClick={onToggleBlocked}
            disabled={busy}
          >
            {user.blocked ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
            {busy ? "Working…" : user.blocked ? "Unblock" : "Block"}
          </button>
        )}
      </div>

      {error ? (
        <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "tide" | "rose" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tone === "tide" &&
          "bg-tide-100 text-tide-700 dark:bg-tide-100/25 dark:text-tide-300",
        tone === "rose" &&
          "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
        tone === "neutral" &&
          "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300",
      )}
    >
      {children}
    </span>
  );
}

/** Create a login: name, 10-digit number, role and a starting password. */
function AddUserModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (user: ManagedUser) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneOk = /^\d{10}$/.test(phone);
  const badPhone = phone.length > 0 && !phoneOk;
  const shortPassword = password.length > 0 && password.length < 8;
  const canSave =
    name.trim().length > 0 && phoneOk && password.length >= 8 && !working;

  async function save() {
    if (!canSave) return;
    setWorking(true);
    setError(null);
    try {
      const response = await api.createUser({
        name: name.trim(),
        phone,
        role,
        password,
      });
      onDone(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this user");
      setWorking(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !working && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-user-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift dark:border-white/10 dark:bg-surface-elevated"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              New login
            </p>
            <h2
              id="add-user-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              Add user
            </h2>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onClose}
            disabled={working}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-tide-400 dark:border-white/10 dark:bg-white/5"
              placeholder="Who is this login for?"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Mobile number
            </span>
            <input
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))
              }
              inputMode="numeric"
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-tide-400 dark:border-white/10 dark:bg-white/5"
              placeholder="10-digit number"
            />
          </label>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Role
            </span>
            <div className="mt-1.5 flex gap-2">
              {(["STAFF", "ADMIN"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  className={clsx(
                    "flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition",
                    role === option
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-100 bg-white text-ink-600 dark:border-white/10 dark:bg-white/5",
                  )}
                >
                  {option === "STAFF" ? "Staff" : "Admin"}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12.5px] text-ink-500">
              {role === "ADMIN"
                ? "Sees prices, analytics and this page. Can't be blocked later."
                : "Day-to-day billing and stock. Can be blocked any time."}
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Password
            </span>
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-tide-400 dark:border-white/10 dark:bg-white/5"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-600">
            <input
              type="checkbox"
              checked={show}
              onChange={(event) => setShow(event.target.checked)}
            />
            Show what I typed
          </label>

          {badPhone ? (
            <p className="text-[13px] text-rose-600">
              Enter all 10 digits of the number.
            </p>
          ) : null}
          {shortPassword ? (
            <p className="text-[13px] text-rose-600">
              Use at least 8 characters.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 dark:border-white/10 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={!canSave}
          >
            <UserPlus className="h-4 w-4" />
            {working ? "Adding…" : "Add user"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Admin types the new password; the old one can't be read back. */
function SetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: ManagedUser;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = password.length >= 8 && confirm === password && !working;

  async function save() {
    if (!canSave) return;
    setWorking(true);
    setError(null);
    try {
      await api.setUserPassword(user.id, password);
      onDone(user.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the password",
      );
      setWorking(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !working && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-password-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift dark:border-white/10 dark:bg-surface-elevated"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Password
            </p>
            <h2
              id="set-password-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              {user.name}
            </h2>
            <p className="mt-1 text-sm text-ink-500">{user.phone}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onClose}
            disabled={working}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-600 dark:bg-white/5 dark:text-ink-300">
            Saved passwords are encrypted and can’t be shown. Type a new one
            here and tell {user.name.split(" ")[0]} what it is.
          </p>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              New password
            </span>
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-tide-400 dark:border-white/10 dark:bg-white/5"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Confirm password
            </span>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-tide-400 dark:border-white/10 dark:bg-white/5"
              placeholder="Type it again"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-600">
            <input
              type="checkbox"
              checked={show}
              onChange={(event) => setShow(event.target.checked)}
            />
            Show what I typed
          </label>

          {tooShort ? (
            <p className="text-[13px] text-rose-600">
              Use at least 8 characters.
            </p>
          ) : null}
          {mismatch ? (
            <p className="text-[13px] text-rose-600">
              The two passwords don’t match.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 dark:border-white/10 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={!canSave}
          >
            <KeyRound className="h-4 w-4" />
            {working ? "Saving…" : "Save password"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ManageUsersPage;
