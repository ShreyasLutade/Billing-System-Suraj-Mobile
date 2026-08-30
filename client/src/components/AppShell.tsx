import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  FilePlus2,
  LogOut,
  Moon,
  Package,
  ReceiptText,
  Sun,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";

export function AppShell() {
  const { isAdmin, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const links = [
    { to: "/", label: "New Bill", icon: FilePlus2 },
    { to: "/bills", label: "Bills", icon: ReceiptText },
    { to: "/dues", label: "Dues", icon: Wallet },
    { to: "/stock", label: "Stock", icon: Package },
    { to: "/suppliers", label: "Suppliers", icon: Truck },
    ...(isAdmin
      ? [{ to: "/analytics", label: "Analytics", icon: BarChart3 }]
      : []),
  ];

  function confirmLogout() {
    logout();
    window.location.assign("/login");
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-tide-400/20 blur-3xl animate-float" />
        <div className="absolute -right-16 top-40 h-80 w-80 rounded-full bg-ink-900/10 blur-3xl dark:bg-tide-400/10" />
      </div>

      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/50 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-surface/85">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 pr-[7.25rem] sm:px-6 sm:pr-36">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-2xl outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-tide-400"
            aria-label="Suraj Mobile — New Bill"
          >
            <img
              src="/suraj_mobile_icon.png"
              alt=""
              className="h-11 w-11 shrink-0 object-contain"
            />
            <div>
              <p className="font-display text-lg font-semibold tracking-tight text-ink-900">
                Suraj Mobile
              </p>
              <p className="text-xs text-ink-500">
                {user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff")} ·
                Balaghat
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-2xl border border-ink-100/80 bg-white/70 p-1 dark:border-ink-100 dark:bg-surface-muted/80 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-ink-900 text-white shadow-soft dark:bg-tide-400 dark:text-ink-50"
                      : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
                  )
                }
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 sm:right-6 sm:gap-2">
          <button
            type="button"
            className="btn-secondary px-2.5 py-2 sm:px-3"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={
              theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2"
            onClick={() => setShowLogoutConfirm(true)}
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>

        {!isOnline ? (
          <div
            role="status"
            aria-label="No internet connection"
            className="absolute inset-x-0 top-full flex h-8 items-center justify-center bg-rose-600 px-4 text-center text-sm font-semibold text-white shadow-sm"
            title="No internet connection"
          >
            Offline
          </div>
        ) : null}
      </header>

      <main
        className={clsx(
          "relative mx-auto max-w-6xl px-4 pb-6 sm:px-6 sm:pb-8",
          isOnline
            ? "pt-[5.5rem] sm:pt-[5.75rem]"
            : "pt-[7.5rem] sm:pt-[7.75rem]",
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <Outlet />
        </motion.div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-white/80 px-3 py-2 backdrop-blur-xl dark:border-white/10 dark:bg-surface/90 md:hidden">
        <div
          className={clsx(
            "mx-auto grid max-w-lg gap-1",
            links.length >= 6
              ? "grid-cols-6"
              : links.length >= 5
                ? "grid-cols-5"
                : links.length >= 4
                  ? "grid-cols-4"
                  : links.length === 3
                    ? "grid-cols-3"
                    : "grid-cols-2",
          )}
        >
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex flex-col items-center gap-1 rounded-2xl px-1.5 py-2 text-[11px] font-semibold",
                  isActive
                    ? "bg-ink-900 text-white dark:bg-tide-400 dark:text-ink-50"
                    : "text-ink-500",
                )
              }
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="h-20 md:hidden" />

      <AnimatePresence>
        {showLogoutConfirm ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center dark:bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="logout-confirm-title"
              className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift dark:border-white/10 dark:bg-surface-elevated"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                    Confirm
                  </p>
                  <h2
                    id="logout-confirm-title"
                    className="mt-1 font-display text-xl font-semibold text-ink-900"
                  >
                    Log out?
                  </h2>
                </div>
                <button
                  type="button"
                  className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                  onClick={() => setShowLogoutConfirm(false)}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="px-5 py-4 text-sm text-ink-600">
                You will need to sign in again with your phone and password to
                continue.
              </p>

              <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowLogoutConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={confirmLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
