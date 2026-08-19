import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

/** Phone + sunrise mark — transparent, stroke via currentColor */
function SurajMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="12"
        y="4"
        width="24"
        height="40"
        rx="6"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <line
        x1="20"
        y1="8.5"
        x2="28"
        y2="8.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M17 31a7 7 0 0 1 14 0Z" fill="#F79A2B" />
      <circle cx="24" cy="30.5" r="4.3" fill="#FFD24A" />
      <g stroke="#FFD24A" strokeWidth="1.85" strokeLinecap="round">
        <line x1="24" y1="18.5" x2="24" y2="14.5" />
        <line x1="17.2" y1="21.2" x2="14.6" y2="18.6" />
        <line x1="30.8" y1="21.2" x2="33.4" y2="18.6" />
        <line x1="15.2" y1="28.5" x2="12.4" y2="28.5" />
        <line x1="32.8" y1="28.5" x2="35.6" y2="28.5" />
        <line x1="18.2" y1="24.2" x2="15.8" y2="21.8" />
        <line x1="29.8" y1="24.2" x2="32.2" y2="21.8" />
      </g>
      <path
        d="M15.5 34.2c2.6-1.4 5.4-2.1 8.5-2.1s5.9.7 8.5 2.1"
        stroke="#F79A2B"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
      ? "Sign in to continue to billing."
      : view === "forgot-phone"
        ? "Enter the account mobile number. We will email an OTP to the shop inbox."
        : `Enter the OTP sent to ${otpEmail || "the shop email"}, then choose a new password.`;

  return (
    <div className="login-page">
      {/* Mobile hero — hidden on desktop */}
      <div className="login-mobile-top">
        <header className="login-mobile-hero">
          <div className="login-mobile-rays" aria-hidden />
          <div className="login-mobile-glow" aria-hidden />
          <div className="login-mobile-hero-txt">
            <p className="login-mobile-name">Suraj Mobile</p>
            <p className="login-mobile-meta">9516533556 · Balaghat</p>
          </div>
        </header>
        <div className="login-mobile-badge" aria-hidden>
          <img
            src="/suraj_mobile_icon.png"
            alt=""
            className="login-mobile-badge-img"
          />
        </div>
      </div>

      <main className="login-auth">
        <section className="login-brand">
          <div className="login-bloom" aria-hidden />

          <div className="login-bp-top">
            <SurajMark className="login-logo" />
            <div className="login-bp-name">
              Suraj Mobile
              <small>9516533556 · Balaghat</small>
            </div>
          </div>

          <div className="login-bp-head">
            <h1>
              The whole shop,
              <br />
              billed in one place.
            </h1>
            <p>
              Bills, stock, dues and suppliers — with cash, online and finance
              splits, and GST invoices in a tap.
            </p>
          </div>

          <div className="login-stage-phone">
            <div className="login-stage-phone-inner">
              <div className="login-phone">
                <div className="login-notch" />
                <div className="login-screen">
                  <div className="login-rc-head">
                    <SurajMark className="login-rc-sun" />
                    <div className="login-rc-shop">
                      Suraj Mobile
                      <small>TAX INVOICE</small>
                    </div>
                  </div>
                  <div className="login-rc-line">
                    <span>iPhone 16 · 128 GB</span>
                    <b>₹71,833</b>
                  </div>
                  <div className="login-rc-line">
                    <span>Tempered glass ×2</span>
                    <b>₹400</b>
                  </div>
                  <div className="login-rc-total">
                    <span>PAYABLE</span>
                    <b>₹72,233</b>
                  </div>
                  <div className="login-rc-bar">
                    <i
                      style={{ width: "52%", background: "var(--login-cash)" }}
                    />
                    <i
                      style={{
                        width: "22%",
                        background: "var(--login-online)",
                      }}
                    />
                    <i
                      style={{
                        width: "14%",
                        background: "var(--login-finance)",
                      }}
                    />
                    <i
                      style={{ width: "12%", background: "var(--login-due)" }}
                    />
                  </div>
                  <div className="login-rc-tags">
                    <span
                      className="login-rc-tag"
                      style={{ background: "#E7F8F1", color: "#0E9E76" }}
                    >
                      <span
                        className="login-rc-dot"
                        style={{ background: "var(--login-cash)" }}
                      />
                      Cash
                    </span>
                    <span
                      className="login-rc-tag"
                      style={{ background: "#E8F0FE", color: "#2563EB" }}
                    >
                      <span
                        className="login-rc-dot"
                        style={{ background: "var(--login-online)" }}
                      />
                      UPI
                    </span>
                    <span
                      className="login-rc-tag"
                      style={{ background: "#F0EBFE", color: "#7C3AED" }}
                    >
                      <span
                        className="login-rc-dot"
                        style={{ background: "var(--login-finance)" }}
                      />
                      EMI
                    </span>
                  </div>
                </div>
                <div className="login-paid">PAID</div>
              </div>

              <div className="login-chip">
                <span className="login-chip-ic">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <div className="login-chip-k">Today&apos;s sales</div>
                  <div className="login-chip-v">₹1.2L</div>
                </div>
              </div>
            </div>
          </div>

          <div className="login-feat">
            <div>
              <span className="login-fi">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              Split any payment — cash, online &amp; finance
            </div>
            <div>
              <span className="login-fi">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              Track stock, exchanges &amp; dues live
            </div>
            <div>
              <span className="login-fi">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              GST-ready invoices, shared as PDF
            </div>
          </div>
        </section>

        <section className="login-form-pane">
          <img
            src="/suraj_mobile_icon.png"
            alt="Suraj Mobile"
            className="login-fp-logo"
          />
          <h2>{heading}</h2>
          <p className="login-sub">{subtitle}</p>

          {view === "login" ? (
          <form onSubmit={handleSubmit} noValidate>
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
                <span className="login-req">*</span>
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
                  placeholder="Your password"
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

            <div className="login-forgot-row">
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
            <form onSubmit={handleResetPassword} noValidate>
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
                    placeholder="At least 8 characters"
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
                  Confirm password
                  <span className="login-req">*</span>
                </label>
                <div className="login-inp">
                  <input
                    id="login-confirm-password"
                    className="login-inp-plain"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearAuthError();
                    }}
                    required
                  />
                </div>
              </div>

              {info ? (
                <div className="login-alert login-alert-ok" role="status">
                  {info}
                </div>
              ) : null}
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
              <button
                type="button"
                className="login-text-btn login-text-btn-center"
                disabled={submitting}
                onClick={() => void sendOtp()}
              >
                Resend OTP
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
        </section>
      </main>
    </div>
  );
}
