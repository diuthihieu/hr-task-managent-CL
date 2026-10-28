"use client";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { safeRedirectPath } from "@/lib/safe-redirect";

type Mode = "login" | "register" | "forgot";

export function AuthCard({ initialMode = "login", callbackUrl = "/workspaces", googleEnabled = false, microsoftEnabled = false, error }: { initialMode?: Mode; callbackUrl?: string; googleEnabled?: boolean; microsoftEnabled?: boolean; error?: string }) {
  const { t, locale } = useT();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [loading, setLoading] = useState(false);
  const [googleCsrfToken, setGoogleCsrfToken] = useState("");
  const [googleCsrfFailed, setGoogleCsrfFailed] = useState(false);
  const [googleCsrfAttempt, setGoogleCsrfAttempt] = useState(0);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const socialEnabled = googleEnabled || microsoftEnabled;
  const [forgotState, setForgotState] = useState<"idle" | "sent" | "unavailable">("idle");
  // Only same-site paths are allowed as a post-login destination.
  const target = safeRedirectPath(callbackUrl);

  useEffect(() => {
    if (!socialEnabled) return;
    const controller = new AbortController();
    fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not prepare Google sign-in");
        const data = (await response.json()) as { csrfToken?: unknown };
        if (typeof data.csrfToken !== "string" || !data.csrfToken) throw new Error("Missing OAuth CSRF token");
        setGoogleCsrfToken(data.csrfToken);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setGoogleCsrfFailed(true);
      });
    return () => controller.abort();
  }, [socialEnabled, googleCsrfAttempt]);

  async function doSignIn() {
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) throw new Error(result.code === "rate_limited" ? t("auth.rateLimited") : t("auth.invalid"));
    // Full navigation: the app renders with the user's own accent / tone,
    // which the (always-orange) landing page's root layout doesn't carry.
    window.location.assign(target);
  }

  async function requestReset() {
    setLoading(true);
    try {
      const res = await fetch("/api/account/password-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 503 && body.code === "mail_unavailable") setForgotState("unavailable");
      else if (!res.ok) throw new Error(body.error || t("common.failed"));
      else setForgotState("sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "forgot") return requestReset();
    if (mode === "register" && password !== confirm) {
      toast.error(t("auth.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "register") await api.post("/api/register", { name, email, password, locale, website });
      await doSignIn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
      setLoading(false);
    }
  }

  return (
    <div id="auth" className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl shadow-indigo-500/5">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 mb-5" role="tablist">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m || (m === "login" && mode === "forgot")}
            onClick={() => setMode(m)}
            className={cn("rounded-md py-1.5 text-sm font-medium", mode === m || (m === "login" && mode === "forgot") ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 shadow-sm" : "text-neutral-500")}
            data-testid={`auth-tab-${m}`}
          >
            {m === "login" ? t("auth.signIn") : t("auth.signUp")}
          </button>
        ))}
      </div>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{mode === "login" ? t("auth.welcomeBack") : mode === "forgot" ? t("auth.forgot.title") : t("auth.createAccount")}</h2>
      <p className="text-sm text-neutral-500 mb-4">{mode === "login" ? t("auth.welcomeBackSub") : mode === "forgot" ? t("auth.forgot.sub") : t("auth.createAccountSub")}</p>
      {mode === "forgot" && forgotState !== "idle" ? (
        <div className="space-y-3" data-testid="forgot-result">
          <p className={cn("rounded-lg px-3 py-2 text-sm", forgotState === "sent" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300")}>
            {forgotState === "sent" ? t("auth.forgot.sent", { email }) : t("auth.forgot.unavailable")}
          </p>
          <button type="button" onClick={() => { setMode("login"); setForgotState("idle"); }} className="text-sm font-medium text-indigo-600 hover:underline">
            ← {t("auth.forgot.back")}
          </button>
        </div>
      ) : (
      <form onSubmit={submit} className="space-y-3">
        {mode === "register" && (
          <div>
            <label htmlFor="auth-name" className="text-xs font-medium text-neutral-500 mb-1 block">{t("auth.fullName")}</label>
            <Input id="auth-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
        )}
        <div>
          <label htmlFor="auth-email" className="text-xs font-medium text-neutral-500 mb-1 block">{t("common.email")}</label>
          <Input id="auth-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
        </div>
        {mode !== "forgot" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="auth-password" className="text-xs font-medium text-neutral-500 block">{t("common.password")}</label>
            {mode === "login" && (
              <button type="button" onClick={() => { setMode("forgot"); setForgotState("idle"); }} className="text-xs font-medium text-indigo-600 hover:underline" data-testid="auth-forgot">
                {t("auth.forgot.link")}
              </button>
            )}
          </div>
          <Input id="auth-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : undefined} />
          {mode === "register" && <p className="text-[11px] text-neutral-400 mt-1">{t("auth.passwordHint")}</p>}
        </div>
        )}
        {mode === "register" && (
          <div>
            <label htmlFor="auth-confirm" className="text-xs font-medium text-neutral-500 mb-1 block">{t("auth.confirmPassword")}</label>
            <Input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        )}
        <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <Button type="submit" disabled={loading} className="w-full justify-center mt-1" data-testid="auth-submit">
          {mode === "forgot" ? (loading ? t("auth.forgot.sending") : t("auth.forgot.send")) : loading ? (mode === "login" ? t("auth.signingIn") : t("auth.creating")) : mode === "login" ? t("auth.signIn") : t("auth.signUp")}
        </Button>
        {mode === "forgot" && (
          <button type="button" onClick={() => setMode("login")} className="w-full text-center text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            ← {t("auth.forgot.back")}
          </button>
        )}
      </form>
      )}
      {socialEnabled && mode !== "forgot" && (
        <>
          <div className="flex items-center gap-3 my-3 text-[11px] text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" /> {t("auth.or")} <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>
          <div className="space-y-2">
            {[
              ...(googleEnabled ? [{ id: "google", icon: <GoogleIcon />, label: mode === "login" ? t("auth.google") : t("auth.googleSignUp") }] : []),
              ...(microsoftEnabled ? [{ id: "microsoft-entra-id", icon: <MicrosoftIcon />, label: mode === "login" ? t("auth.microsoft") : t("auth.microsoftSignUp") }] : []),
            ].map((p) => (
              <form
                key={p.id}
                action={`/api/auth/signin/${p.id}`}
                method="post"
                onSubmit={(event) => {
                  if (!googleCsrfToken) {
                    event.preventDefault();
                    if (googleCsrfFailed) {
                      setGoogleCsrfFailed(false);
                      setGoogleCsrfAttempt((attempt) => attempt + 1);
                      toast.error(t("common.failed"));
                    }
                    return;
                  }
                  if (socialLoading) {
                    event.preventDefault();
                    return;
                  }
                  setSocialLoading(p.id);
                }}
              >
                <input type="hidden" name="csrfToken" value={googleCsrfToken} />
                <input type="hidden" name="callbackUrl" value={target} />
                <Button type="submit" variant="outline" className="w-full justify-center" disabled={!!socialLoading || (!googleCsrfToken && !googleCsrfFailed)} data-testid={p.id === "google" ? "auth-google" : "auth-microsoft"}>
                  {p.icon} {socialLoading === p.id || (!googleCsrfToken && !googleCsrfFailed) ? t("common.loading") : p.label}
                </Button>
              </form>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-3 text-center" data-testid="auth-error">{t(error === "account_disabled" ? "auth.err.disabled" : error === "google_unverified" ? "auth.err.googleUnverified" : error === "microsoft_unverified" ? "auth.err.microsoftUnverified" : error === "microsoft_no_email" ? "auth.err.microsoftNoEmail" : "auth.err.generic")}</p>}
      <p className="text-xs text-neutral-500 mt-4 text-center">
        {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
        <button className="text-indigo-600 hover:underline font-medium" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? t("auth.signUp") : t("auth.signIn")}
        </button>
      </p>
      {mode === "register" && <p className="text-[11px] text-neutral-400 mt-2 text-center">{t("auth.terms")}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
