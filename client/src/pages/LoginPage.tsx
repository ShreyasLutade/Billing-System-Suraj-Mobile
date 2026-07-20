import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Lock, Phone } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const FLOATING_SPECKS = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  left: `${14 + ((i * 31) % 72)}%`,
  top: `${16 + ((i * 39) % 68)}%`,
  size: 2 + (i % 2),
  delay: (i % 4) * 1.4,
  duration: 9 + (i % 3) * 2,
}));

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from &&
    (location.state as { from?: string }).from !== "/login"
      ? (location.state as { from: string }).from
      : "/";

  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validatePhone(value: string) {
    if (!value) return "Phone number is required";
    if (value.length !== 10) return "Phone number must be 10 digits";
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const phoneIssue = validatePhone(phone);
    if (phoneIssue) {
      setPhoneError(phoneIssue);
      document.getElementById("login-phone")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await login(phone.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="login-aurora pointer-events-none absolute inset-0" />
      <div className="login-grid pointer-events-none absolute inset-0" />

      <div className="login-orb login-orb-a pointer-events-none absolute -left-24 top-8 h-80 w-80 rounded-full" />
      <div className="login-orb login-orb-b pointer-events-none absolute -right-20 bottom-8 h-96 w-96 rounded-full" />
      <div className="login-orb login-orb-c pointer-events-none absolute left-[40%] top-[22%] h-56 w-56 rounded-full" />

      <div
        className="login-ring login-ring-a pointer-events-none absolute h-[28rem] w-[28rem] rounded-full border border-tide-400/20"
        style={{ left: "50%", top: "50%", marginLeft: "-14rem", marginTop: "-14rem" }}
      />

      {FLOATING_SPECKS.map((speck) => (
        <span
          key={speck.id}
          className="login-speck pointer-events-none absolute rounded-full"
          style={{
            left: speck.left,
            top: speck.top,
            width: speck.size,
            height: speck.size,
            animationDelay: `${speck.delay}s`,
            animationDuration: `${speck.duration}s`,
          }}
        />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="login-card glass-panel p-7 sm:p-9">
          <div className="mb-8 text-center">
            <img
              src="/favicon.svg"
              alt=""
              className="mx-auto h-16 w-16 object-contain"
            />
            <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-ink-900">
              Suraj Mobile
            </h1>
            <p className="mt-2 text-sm text-ink-500">
              Sign in to continue to billing
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label required" htmlFor="login-phone">
                Phone number
              </label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                <input
                  id="login-phone"
                  className={`field pl-11 ${phoneError ? "border-ember-400 focus:border-ember-500 focus:ring-ember-200" : ""}`}
                  inputMode="numeric"
                  autoComplete="username"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  value={phone}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setPhone(next);
                    if (phoneError && next.length === 10) setPhoneError(null);
                  }}
                  onBlur={() => setPhoneError(validatePhone(phone))}
                  aria-invalid={Boolean(phoneError)}
                  aria-describedby={phoneError ? "login-phone-error" : undefined}
                  required
                />
              </div>
              {phoneError ? (
                <p
                  id="login-phone-error"
                  className="mt-1.5 text-xs font-medium text-ember-500"
                  role="alert"
                >
                  {phoneError}
                </p>
              ) : null}
            </div>

            <div>
              <label className="label required" htmlFor="login-password">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                <input
                  id="login-password"
                  className="field pl-11 pr-12"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-ember-500"
                >
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>

            <button
              type="submit"
              disabled={submitting || phone.length !== 10 || !password}
              className="btn-primary mt-2 w-full"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
