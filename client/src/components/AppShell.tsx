import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  LogOut,
  Menu,
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
import { clearListUiSession } from "../hooks/useSessionState";
import { api } from "../lib/api";

export function AppShell() {
  const { isAdmin, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const mainRef = useRef<HTMLElement | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [openDueCount, setOpenDueCount] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void api
      .listDues("all")
      .then(({ data }) => {
        if (active) setOpenDueCount(data.count);
      })
      .catch(() => {
        if (active) setOpenDueCount(null);
      });
    return () => {
      active = false;
    };
  }, [user]);

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

  // .babu-main is the scroll container, so the browser won't reset it between
  // routes. Start new pages at the top; keep the position on Back (POP).
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === "POP") return;
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, navigationType]);

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
    <div className={clsx("babu-shell", sidebarCollapsed && "is-sidebar-collapsed")}>
      <aside className="babu-sidebar">
        <button
          type="button"
          className="babu-sidebar-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
        <Link to="/" onClick={onMainNavClick} className="babu-brand" aria-label="Babu Mobile — New Bill">
          <img src="/babu_mobile_icon.svg" alt="" />
          <span>
            <strong>Babu Mobile</strong>
            <small>Balaghat</small>
          </span>
        </Link>

        <nav className="babu-sidebar-nav" aria-label="Main navigation">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              onClick={onMainNavClick}
              className={({ isActive }) => clsx("babu-nav-link", isActive && "is-active")}
            >
              <link.icon />
              <span>{link.label}</span>
              {link.to === "/dues" && openDueCount ? (
                <b className="babu-nav-count">{openDueCount}</b>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="babu-sidebar-foot">
          <div className="babu-user-card">
            <span>{(user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff")).slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff")}</strong>
              <small>{user?.phone || "7581817575"}</small>
            </div>
          </div>
          <button type="button" className="babu-utility-button" onClick={toggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {isAdmin ? (
            <Link to="/backup" onClick={onMainNavClick} className="babu-utility-button">
              <Package /> Restore data
            </Link>
          ) : null}
          <button type="button" className="babu-utility-button" onClick={() => setShowLogoutConfirm(true)}>
            <LogOut /> Logout
          </button>
        </div>
      </aside>

      <header className="babu-mobile-header">
        <Link to="/" onClick={onMainNavClick} className="babu-mobile-brand" aria-label="Babu Mobile — New Bill">
          <img src="/babu_mobile_icon.svg" alt="" />
          <strong>Babu Mobile</strong>
        </Link>
        <button
          type="button"
          className="babu-mobile-menu-btn babu-mobile-menu-open"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileMenuOpen}
        >
          <Menu />
        </button>
      </header>

      <AnimatePresence>
        {mobileMenuOpen ? (
          <motion.div
            className="babu-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
          >
            <motion.aside
              className="babu-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="babu-drawer-head">
                <div className="babu-brand">
                  <img src="/babu_mobile_icon.svg" alt="" />
                  <span>
                    <strong>Babu Mobile</strong>
                    <small>Balaghat</small>
                  </span>
                </div>
                <button
                  type="button"
                  className="babu-mobile-menu-btn"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                >
                  <X />
                </button>
              </div>

              <div className="babu-sidebar-foot">
                <div className="babu-user-card">
                  <span>{(user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff")).slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{user?.name || (user?.role === "ADMIN" ? "Admin" : "Staff")}</strong>
                    <small>{user?.phone || "7581817575"}</small>
                  </div>
                </div>
                <button type="button" className="babu-utility-button" onClick={toggleTheme}>
                  {theme === "dark" ? <Sun /> : <Moon />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                {isAdmin ? (
                  <Link
                    to="/backup"
                    onClick={() => {
                      onMainNavClick();
                      setMobileMenuOpen(false);
                    }}
                    className="babu-utility-button"
                  >
                    <Package /> Restore data
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="babu-utility-button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowLogoutConfirm(true);
                  }}
                >
                  <LogOut /> Logout
                </button>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main ref={mainRef} className="babu-main">
        {!isOnline ? <div className="babu-offline-banner">Offline</div> : null}
        {/* CSS animation (not a transform left in place) so popups inside pages
            aren't trapped below the header and bottom nav. */}
        <div className="babu-page-enter">
          <Outlet />
        </div>
      </main>

      <nav className="babu-mobile-nav" aria-label="Mobile navigation">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            onClick={onMainNavClick}
            className={({ isActive }) => clsx("babu-mobile-link", isActive && "is-active")}
          >
            <span className="babu-mobile-icon-wrap">
              <link.icon />
              {link.to === "/dues" && openDueCount ? <b>{openDueCount}</b> : null}
            </span>
            {link.label}
          </NavLink>
        ))}
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
            className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-ink-900 text-white shadow-lift transition-[transform,background-color,box-shadow] duration-250 ease-out hover:scale-105 hover:bg-ink-800 dark:border-white/10 dark:bg-tide-400 dark:text-ink-900 md:bottom-6"
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
