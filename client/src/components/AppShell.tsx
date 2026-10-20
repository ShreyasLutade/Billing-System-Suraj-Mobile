import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  BarChart3,
  FilePlus2,
  LogOut,
  Moon,
  Package,
  ReceiptText,
  Sun,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { clearListUiSession } from "../hooks/useSessionState";

const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-700 transition hover:bg-ink-50 hover:text-ink-900 focus-visible:bg-ink-50 focus-visible:outline-none dark:text-ink-100 dark:hover:bg-white/5";

export function AppShell() {
  const { isAdmin, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const mainRef = useRef<HTMLElement | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountName = user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff");
  const location = useLocation();

  // Account menu: close on outside click, Escape, or when the page changes.
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname]);

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

  useEffect(() => {
    const node = mainRef.current;
    if (!node) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;

      ticking = true;
      requestAnimationFrame(() => {
        setShowScrollToTop(node.scrollTop > 160);
        ticking = false;
      });
    };

    handleScroll();
    node.addEventListener("scroll", handleScroll, { passive: true });
    return () => node.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollToTop() {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const links = [
    { to: "/", label: "New Bill", icon: FilePlus2 },
    { to: "/bills", label: "Bills", icon: ReceiptText },
    { to: "/dues", label: "Dues", icon: Wallet },
    { to: "/stock", label: "Stock", icon: Package },
    { to: "/suppliers", label: "Suppliers", icon: Truck },
    ...(isAdmin ? [{ to: "/analytics", label: "Analytics", icon: BarChart3 }] : []),
  ];

  function onMainNavClick() {
    // Header / bottom nav = fresh list. Detail → back keeps search via session.
    clearListUiSession();
  }

  function confirmLogout() {
    logout();
    window.location.assign("/login");
  }

  return (
    // Pinned to the visible viewport: on iOS, 100vh (h-screen) is taller than the
    // screen, which let the whole page shift up under the fixed header.
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-tide-400/20 blur-3xl animate-float" />
        <div className="absolute -right-16 top-40 h-80 w-80 rounded-full bg-ink-900/10 blur-3xl dark:bg-tide-400/10" />
      </div>

      <header className="fixed inset-x-0 top-0 z-40 border-b border-ink-100 bg-white pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-white/10 dark:bg-surface/85">
        <div
          className={clsx(
            "mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6",
            "pr-16 sm:pr-20",
          )}
        >
          <Link
            to="/"
            onClick={onMainNavClick}
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
                onClick={onMainNavClick}
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

        {/* Account circle: opens Dark mode / Restore data / Recycle bin / Logout. */}
        <div
          ref={accountMenuRef}
          className="absolute right-3 top-1/2 -translate-y-1/2 sm:right-6"
        >
          <button
            type="button"
            className={clsx(
              "grid h-11 w-11 place-items-center rounded-full bg-ink-900 font-display text-base font-semibold text-white shadow-soft ring-offset-2 transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tide-400 dark:bg-tide-400 dark:text-ink-50 dark:ring-offset-surface",
              accountMenuOpen && "ring-2 ring-tide-400",
            )}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label="Account options"
            title="Account options"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            {accountName.slice(0, 1).toUpperCase()}
          </button>

          <AnimatePresence>
            {accountMenuOpen ? (
              <motion.div
                role="menu"
                aria-label="Account"
                className="absolute right-0 top-[calc(100%+0.5rem)] w-60 overflow-hidden rounded-2xl border border-ink-100 bg-white p-1.5 shadow-lift dark:border-white/10 dark:bg-surface-elevated"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <div className="mb-1 border-b border-ink-100 px-3 pb-2.5 pt-2 dark:border-white/10">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {accountName}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {user?.phone || (isAdmin ? "Admin" : "Staff")}
                  </p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    toggleTheme();
                    setAccountMenuOpen(false);
                  }}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                {isAdmin ? (
                  <Link
                    to="/users"
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => {
                      onMainNavClick();
                      setAccountMenuOpen(false);
                    }}
                  >
                    <Users className="h-4 w-4" />
                    Manage users
                  </Link>
                ) : null}
                {isAdmin ? (
                  <Link
                    to="/backup"
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => {
                      onMainNavClick();
                      setAccountMenuOpen(false);
                    }}
                  >
                    <Package className="h-4 w-4" />
                    Restore data
                  </Link>
                ) : null}
                {isAdmin ? (
                  <Link
                    to="/recycle-bin"
                    role="menuitem"
                    className={clsx(
                      menuItemClass,
                      "!text-rose-600 hover:!bg-rose-50 dark:!text-rose-400 dark:hover:!bg-rose-500/10",
                    )}
                    onClick={() => {
                      onMainNavClick();
                      setAccountMenuOpen(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Recycle bin
                  </Link>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setShowLogoutConfirm(true);
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
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
        ref={mainRef}
        className={clsx(
          "relative mx-auto min-h-0 flex-1 w-full max-w-6xl overflow-y-auto overscroll-y-contain scroll-pt-28 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 sm:scroll-pt-32 sm:pb-8",
          isOnline
            ? "pt-[calc(6.5rem+env(safe-area-inset-top))] sm:pt-[calc(6.75rem+env(safe-area-inset-top))]"
            : "pt-[calc(8.5rem+env(safe-area-inset-top))] sm:pt-[calc(8.75rem+env(safe-area-inset-top))]",
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

      <nav className="app-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-white/80 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl dark:border-white/10 dark:bg-surface/90 md:hidden">
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
              onClick={onMainNavClick}
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

      <AnimatePresence>
        {showScrollToTop ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.72, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.72, y: 16 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={scrollToTop}
            className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-ink-900 text-white shadow-lift transition-[transform,background-color,box-shadow] duration-250 ease-out hover:scale-105 hover:bg-ink-800 dark:border-white/10 dark:bg-tide-400 dark:text-ink-900 md:bottom-6 [body.has-fab_&]:bottom-[10.5rem] md:[body.has-fab_&]:bottom-6"
            aria-label="Scroll to top"
            title="Scroll to top"
          >
            <ArrowUp className="h-5 w-5" />
          </motion.button>
        ) : null}
      </AnimatePresence>

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
