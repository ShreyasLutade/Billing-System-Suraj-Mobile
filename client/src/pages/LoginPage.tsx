import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { useTheme } from "../theme/ThemeContext";

/** Babu Mobile mark — a phone-shaped B with camera and signal details. */
function BabuMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="babu-mark-gradient" x1="8" y1="4" x2="58" y2="60">
          <stop stopColor="#1ABAFF" />
          <stop offset="0.62" stopColor="#3F95E0" />
          <stop offset="1" stopColor="#5D73B6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="20" fill="url(#babu-mark-gradient)" />
      <path
        d="M22 15V49M22 15H33a8.5 8.5 0 0 1 0 17H22M22 32H35a8.5 8.5 0 0 1 0 17H22"
        stroke="white"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33" cy="23.5" r="2.3" fill="#1ABAFF" />
      <rect x="29" y="39.5" width="9" height="3" rx="1.5" fill="#1ABAFF" />
      <path
        d="M46 13a10 10 0 0 1 6 6M46 8a15 15 0 0 1 10 10"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<"login" | "forgot-phone" | "forgot-reset">(
    "login",
  );
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function clearAuthError() {
    if (error) setError(null);
  }

  function resetForgotState() {
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setOtpEmail(null);
    setError(null);
    setInfo(null);
    setPhoneError(null);
  }

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

  async function sendOtp() {
    setError(null);
    setInfo(null);
    const phoneIssue = validatePhone(phone);
    if (phoneIssue) {
      setPhoneError(phoneIssue);
      document.getElementById("login-phone")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.requestPasswordOtp(phone.trim());
      setOtpEmail(data.email);
      setView("forgot-reset");
      setInfo(`OTP sent to ${data.email}. Ask the shop owner for the code.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendOtp(event: FormEvent) {
    event.preventDefault();
    await sendOtp();
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (otp.replace(/\D/g, "").length !== 6) {
      setError("Enter the 6-digit OTP");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(phone.trim(), otp.replace(/\D/g, ""), newPassword);
      resetForgotState();
      setPassword("");
      setView("login");
      setInfo("Password updated. Sign in with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  }

  const heading =
    view === "login"
      ? "Welcome back"
      : view === "forgot-phone"
        ? "Forgot password"
        : "Reset password";
  const subtitle =
    view === "login"
      ? "Sign in to start billing, track stock and collect dues."
      : view === "forgot-phone"
        ? "Enter the account mobile. OTP goes to the shop Gmail."
        : `OTP sent to ${otpEmail || "the shop Gmail"}.`;

  return (
    <div className={view === "login" ? "login-page" : "login-page login-page-forgot"}>
      <button
        type="button"
        className="login-theme-toggle"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label={
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      {/* Mobile hero — hidden on desktop */}
      <div className="login-mobile-top">
        <header className="login-mobile-hero">
          <div className="login-mobile-rays" aria-hidden />
          <div className="login-mobile-glow" aria-hidden />
          <div className="login-mobile-hero-txt">
            <p className="login-mobile-name">Babu Mobile</p>
            <p className="login-mobile-meta">7581817575 · Balaghat</p>
          </div>
        </header>
        <div className="login-mobile-badge" aria-hidden>
          <BabuMark className="login-mobile-badge-mark" />
        </div>
      </div>

      <main className="login-auth">
        <section className="login-brand">
          <div className="login-bloom" aria-hidden />

          <div className="login-bp-top">
                    <BabuMark className="login-logo" />
            <div className="login-bp-name">
              Babu Mobile
              <small>7581817575 · Balaghat</small>
            </div>
          </div>

          <div className="login-bp-head">
            <h1>
              Sell more.
              <br />
              <em>Miss nothing.</em>
            </h1>
          </div>

          <div className="login-stage-phone">
            <div className="login-stage-phone-inner">
              <div className="login-phone">
                <div className="login-notch" />
                <div className="login-screen">
                  <div className="login-dashboard-title">Today&apos;s sales</div>
                  <div className="login-dashboard-amount">₹1,24,580</div>
                  <div className="login-dashboard-bars" aria-hidden>
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="login-dashboard-line">
                    iPhone 16 <span>₹71,833</span>
                  </div>
                  <div className="login-dashboard-line">
                    Back cover ×3 <span>₹900</span>
                  </div>
                  <div className="login-dashboard-line">
                    Tempered glass <span>₹400</span>
                  </div>
                </div>
              </div>

              <div className="login-art-card login-art-dues">
                <small>Pending dues</small>
                <strong>₹18,250</strong>
                <div className="login-art-chips">
                  <span>Cash</span>
                  <span>UPI</span>
                  <span>EMI</span>
                </div>
              </div>
              <div className="login-art-card login-art-stock">
                <small>Low stock alert</small>
                <strong>6 items</strong>
              </div>
              <div className="login-art-pill">
                <span>✓</span>
                Invoice shared on WhatsApp
              </div>
            </div>
          </div>
        </section>

        <section className="login-form-pane">
          <div className="login-fp-brand">
            <BabuMark className="login-fp-mark" />
            <div>
              <strong>Babu Mobile</strong>
              <span>Balaghat · 7581817575</span>
            </div>
          </div>
          {view === "login" ? (
            <h2 className="login-welcome-heading">
              <span>Open the shop,</span>
              <strong>one tap away.</strong>
            </h2>
          ) : (
            <h2>{heading}</h2>
          )}
          <p className="login-sub">{subtitle}</p>

          {view === "login" ? (
          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-phone">
                Phone number
              </label>
              <div className="login-inp">
                <svg
                  className="login-lead"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  id="login-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="username"
                  maxLength={10}
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setPhone(next);
                    clearAuthError();
                    if (phoneError && next.length === 10) setPhoneError(null);
                  }}
                  onBlur={() => setPhoneError(validatePhone(phone))}
                  aria-invalid={Boolean(phoneError)}
                  aria-describedby={
                    phoneError
                      ? "login-phone-error"
                      : error
                        ? "login-auth-error"
                        : undefined
                  }
                  required
                />
              </div>
              {phoneError ? (
                <p
                  id="login-phone-error"
                  className="login-error-inline"
                  role="alert"
                >
                  {phoneError}
                </p>
              ) : null}
            </div>

            <div
              className={
                error && !phoneError ? "login-field login-field-err" : "login-field"
              }
            >
              <label htmlFor="login-password">
                Password
              </label>
              <div className="login-inp">
                <svg
                  className="login-lead"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <rect
                    x="4"
                    y="10"
                    width="16"
                    height="10"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 10V7a4 4 0 0 1 8 0v3"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearAuthError();
                  }}
                  required
                />
                <button
                  className="login-eye"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.3 6.3A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 3-.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="3"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="login-login-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Keep me signed in</span>
              </label>
              <button
                type="button"
                className="login-text-btn"
                onClick={() => {
                  resetForgotState();
                  setView("forgot-phone");
                }}
              >
                Forgot password?
              </button>
            </div>

            <AnimatePresence>
              {info && !error ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="login-alert login-alert-ok"
                  role="status"
                >
                  {info}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {error ? (
                <motion.div
                  id="login-auth-error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="login-alert"
                  role="alert"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M12 8v5M12 16h.01"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  {error}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <button
              type="submit"
              className="login-btn"
              disabled={submitting || phone.length !== 10 || !password}
            >
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </button>
          </form>
          ) : null}

          {view === "forgot-phone" ? (
            <form onSubmit={handleSendOtp} noValidate>
              <div className="login-field">
                <label htmlFor="login-phone">
                  Phone number
                  <span className="login-req">*</span>
                </label>
                <div className="login-inp">
                  <svg
                    className="login-lead"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="username"
                    maxLength={10}
                    placeholder="10-digit mobile"
                    value={phone}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setPhone(next);
                      clearAuthError();
                      if (phoneError && next.length === 10) setPhoneError(null);
                    }}
                    required
                  />
                </div>
                {phoneError ? (
                  <p className="login-error-inline" role="alert">
                    {phoneError}
                  </p>
                ) : null}
              </div>

              {error ? (
                <div className="login-alert" role="alert">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                className="login-btn"
                disabled={submitting || phone.length !== 10}
              >
                {submitting ? "Sending OTP…" : "Send OTP"}
              </button>
              <button
                type="button"
                className="login-text-btn login-text-btn-center"
                onClick={() => {
                  resetForgotState();
                  setView("login");
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : null}

          {view === "forgot-reset" ? (
            <form className="login-reset-form" onSubmit={handleResetPassword} noValidate>
              <div className="login-field">
                <label htmlFor="login-otp">
                  OTP
                  <span className="login-req">*</span>
                </label>
                <div className="login-inp">
                  <input
                    id="login-otp"
                    className="login-inp-plain"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                      clearAuthError();
                    }}
                    required
                  />
                </div>
              </div>

              <div className="login-reset-passwords">
                <div className="login-field">
                  <label htmlFor="login-new-password">
                    New password
                    <span className="login-req">*</span>
                  </label>
                  <div className="login-inp">
                    <input
                      id="login-new-password"
                      className="login-inp-plain"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        clearAuthError();
                      }}
                      required
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label htmlFor="login-confirm-password">
                    Confirm
                    <span className="login-req">*</span>
                  </label>
                  <div className="login-inp">
                    <input
                      id="login-confirm-password"
                      className="login-inp-plain"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Re-enter"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        clearAuthError();
                      }}
                      required
                    />
                  </div>
                </div>
              </div>

              {error ? (
                <div className="login-alert" role="alert">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                className="login-btn"
                disabled={
                  submitting ||
                  otp.length !== 6 ||
                  newPassword.length < 8 ||
                  !confirmPassword
                }
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
              <div className="login-reset-links">
                <button
                  type="button"
                  className="login-text-btn"
                  disabled={submitting}
                  onClick={() => void sendOtp()}
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  className="login-text-btn"
                  onClick={() => {
                    resetForgotState();
                    setView("login");
                  }}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          ) : null}

          {view === "login" ? (
            <div className="login-security-foot">
              <span aria-hidden />
              Secure · GST-ready invoices · Works on phone &amp; desktop
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
