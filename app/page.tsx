"use client";

import {
  Bell,
  CalendarClock,
  CircleStop,
  ExternalLink,
  KeyRound,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  FREQUENCY_OPTIONS,
  frequencyToMinutes,
  type AuthResponse,
  type AuthUser,
  type FrequencyOption,
  type PropertyAgentStatusResponse,
  type PropertyFinding,
} from "@/lib/types";

type FormState = {
  websites_to_search: string;
  areas_to_search: string;
  property_criteria: string;
  frequency: FrequencyOption;
  run_time_uk: string;
  model: string;
  openai_api_key: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_api_base_url: string;
};

type AuthFormState = {
  mode: "login" | "create";
  username: string;
  password: string;
};

const SESSION_STORAGE_KEY = "property-agent-session";

const defaultFormState: FormState = {
  websites_to_search: "",
  areas_to_search: "",
  property_criteria: "",
  frequency: "Daily",
  run_time_uk: "09:00",
  model: "gpt-5",
  openai_api_key: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  telegram_api_base_url: "https://api.telegram.org",
};

const defaultAuthFormState: AuthFormState = {
  mode: "login",
  username: "",
  password: "",
};

const tableColumns: Array<{ key: keyof PropertyFinding; label: string }> = [
  { key: "rank", label: "Rank" },
  { key: "property", label: "Property" },
  { key: "price", label: "Price" },
  { key: "size_sqm", label: "Size" },
  { key: "pounds_per_sqm", label: "GBP/sqm" },
  { key: "service_charge", label: "Service charge" },
  { key: "ground_rent", label: "Ground rent" },
  { key: "location", label: "Location" },
  { key: "key_strengths", label: "Strengths" },
  { key: "main_issues", label: "Issues" },
  { key: "listing_url", label: "Listing" },
];

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [authForm, setAuthForm] = useState<AuthFormState>(defaultAuthFormState);
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [agentStatus, setAgentStatus] = useState<PropertyAgentStatusResponse | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [authMessage, setAuthMessage] = useState<string>("");

  const selectedMinutes = frequencyToMinutes[form.frequency];
  const requiresRunTime = form.frequency !== "Hourly";
  const isValidRunTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(form.run_time_uk.trim());
  const isRunning = agentStatus?.is_running ?? false;

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setAgentStatus(null);
    setForm(defaultFormState);
    setMessage("");
  }, []);

  const authHeaders = useCallback(
    (headers?: Record<string, string>): Record<string, string> => {
      if (!session) {
        return headers ?? {};
      }

      return {
        ...headers,
        Authorization: `Bearer ${session.session_token}`,
      };
    },
    [session],
  );

  const handleUnauthorized = useCallback(
    (detail: string) => {
      clearSession();
      setAuthMessage(detail);
    },
    [clearSession],
  );

  const loadStatus = useCallback(
    async (options?: { syncForm?: boolean; showLoading?: boolean }) => {
      if (!session) {
        setIsLoadingStatus(false);
        return;
      }

      const syncForm = options?.syncForm ?? false;
      const showLoading = options?.showLoading ?? true;

      if (showLoading) {
        setIsLoadingStatus(true);
      }

      try {
        const response = await fetch("/api/property-agent/status", {
          cache: "no-store",
          headers: authHeaders(),
        });
        const payload = (await response.json()) as unknown;
        if (response.status === 401) {
          handleUnauthorized(errorDetail(payload) ?? "Session expired. Sign in again.");
          return;
        }

        if (!response.ok) {
          throw new Error(errorDetail(payload) ?? "Failed to load agent status.");
        }

        const statusPayload = payload as PropertyAgentStatusResponse;
        setAgentStatus(statusPayload);
        if (syncForm && statusPayload.config) {
          setForm({
            websites_to_search: statusPayload.config.websites_to_search.join(", "),
            areas_to_search: statusPayload.config.areas_to_search.join(", "),
            property_criteria: statusPayload.config.property_criteria,
            frequency: minutesToFrequency(statusPayload.config.update_frequency_minutes) ?? "Daily",
            run_time_uk: statusPayload.config.run_time_uk ?? "09:00",
            model: statusPayload.config.model,
            openai_api_key: "",
            telegram_bot_token: "",
            telegram_chat_id: statusPayload.config.telegram_chat_id ?? "",
            telegram_api_base_url: statusPayload.config.telegram_api_base_url ?? "https://api.telegram.org",
          });
        }
      } catch (error) {
        if (showLoading) {
          setMessage((error as Error).message);
        }
      } finally {
        if (showLoading) {
          setIsLoadingStatus(false);
        }
      }
    },
    [authHeaders, handleUnauthorized, session],
  );

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      const storedSession = storedAuthSession();
      if (!storedSession) {
        if (isMounted) {
          setIsCheckingSession(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${storedSession.session_token}`,
          },
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok || !isSessionPayload(payload)) {
          throw new Error(errorDetail(payload) ?? "Sign in again.");
        }

        if (isMounted) {
          setSession({
            ...storedSession,
            user: payload.user,
          });
        }
      } catch (error) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        if (isMounted) {
          setAuthMessage((error as Error).message);
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (session) {
      void loadStatus({ syncForm: true });
      return;
    }

    setIsLoadingStatus(false);
  }, [loadStatus, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadStatus({ showLoading: false });
    }, isRunning ? 5000 : 15000);

    return () => window.clearInterval(intervalId);
  }, [isRunning, loadStatus, session]);

  const statusTone = useMemo(() => {
    if (isCheckingSession || isLoadingStatus) {
      return "neutral";
    }

    return isRunning ? "running" : "stopped";
  }, [isCheckingSession, isLoadingStatus, isRunning]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok || !isAuthResponse(payload)) {
        throw new Error(errorDetail(payload) ?? "Failed to sign in.");
      }

      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
      setSession(payload);
      setAuthForm((current) => ({
        ...current,
        username: payload.user.username,
        password: "",
      }));
      setMessage("");
    } catch (error) {
      setAuthMessage((error as Error).message);
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setAuthMessage("Sign in to use your property agent.");
      return;
    }

    if (requiresRunTime && !isValidRunTime) {
      setMessage("Enter Time (UK) in HH:MM format.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/property-agent/set-search", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          websites_to_search: form.websites_to_search,
          areas_to_search: form.areas_to_search,
          property_criteria: form.property_criteria,
          update_frequency_minutes: selectedMinutes,
          run_time_uk: requiresRunTime ? form.run_time_uk.trim() : null,
          model: form.model,
          openai_api_key: form.openai_api_key,
          telegram_bot_token: form.telegram_bot_token,
          telegram_chat_id: form.telegram_chat_id,
          telegram_api_base_url: form.telegram_api_base_url,
        }),
      });
      const payload = (await response.json()) as { detail?: string };

      if (response.status === 401) {
        handleUnauthorized(payload.detail ?? "Session expired. Sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(payload.detail ?? "Failed to start property agent.");
      }

      setMessage("Agent started. First search is running in the background.");
      setForm((current) => ({ ...current, openai_api_key: "", telegram_bot_token: "" }));
      await loadStatus({ showLoading: false });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancel() {
    if (!session) {
      setAuthMessage("Sign in to use your property agent.");
      return;
    }

    setIsCancelling(true);
    setMessage("");

    try {
      const response = await fetch("/api/property-agent/cancel", {
        method: "POST",
        headers: authHeaders(),
      });
      const payload = (await response.json()) as { detail?: string };

      if (response.status === 401) {
        handleUnauthorized(payload.detail ?? "Session expired. Sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(payload.detail ?? "Failed to cancel property agent.");
      }

      setMessage("Property agent stopped.");
      await loadStatus({ showLoading: false });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsCancelling(false);
    }
  }

  function handleLogout() {
    if (session) {
      void fetch("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => undefined);
    }

    clearSession();
    setAuthMessage("");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateAuthForm<K extends keyof AuthFormState>(key: K, value: AuthFormState[K]) {
    setAuthForm((current) => ({ ...current, [key]: value }));
  }

  if (isCheckingSession) {
    return (
      <main className="shell auth-shell">
        <section className="topbar" aria-label="Agent overview">
          <div>
            <p className="eyebrow">Private property monitor</p>
            <h1>UK Property Search Agent</h1>
          </div>
          <div className="status-chip neutral">
            <span aria-hidden="true" />
            Checking
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="shell auth-shell">
        <section className="topbar" aria-label="Agent overview">
          <div>
            <p className="eyebrow">Private property monitor</p>
            <h1>UK Property Search Agent</h1>
          </div>
          <div className="status-chip stopped">
            <span aria-hidden="true" />
            Signed out
          </div>
        </section>

        <form className="panel auth-panel" onSubmit={handleAuthSubmit}>
          <div className="panel-heading">
            <ShieldCheck size={18} aria-hidden="true" />
            <h2>{authForm.mode === "login" ? "Log In" : "Create Account"}</h2>
          </div>

          <div className="segmented auth-segmented" role="radiogroup" aria-label="Account mode">
            <button
              type="button"
              className={authForm.mode === "login" ? "selected" : ""}
              onClick={() => updateAuthForm("mode", "login")}
              aria-pressed={authForm.mode === "login"}
            >
              Log In
            </button>
            <button
              type="button"
              className={authForm.mode === "create" ? "selected" : ""}
              onClick={() => updateAuthForm("mode", "create")}
              aria-pressed={authForm.mode === "create"}
            >
              Create
            </button>
          </div>

          <label className="field">
            <span>Username</span>
            <input
              value={authForm.username}
              onChange={(event) => updateAuthForm("username", event.target.value)}
              placeholder="your-name"
              autoComplete="username"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => updateAuthForm("password", event.target.value)}
              placeholder="At least 8 characters"
              autoComplete={authForm.mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          <button className="primary-button full-button" type="submit" disabled={isSigningIn}>
            <UserRound size={17} aria-hidden="true" />
            {isSigningIn ? "Working..." : authForm.mode === "login" ? "Log In" : "Create Account"}
          </button>

          {authMessage ? <p className="message">{authMessage}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Agent overview">
        <div>
          <p className="eyebrow">Private property monitor</p>
          <h1>UK Property Search Agent</h1>
        </div>
        <div className="topbar-actions">
          <div className="account-pill">
            <UserRound size={15} aria-hidden="true" />
            {session.user.username}
          </div>
          <button className="secondary-button compact-action" type="button" onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            Sign Out
          </button>
          <div className={`status-chip ${statusTone}`}>
            <span aria-hidden="true" />
            {isLoadingStatus ? "Checking" : isRunning ? "Running" : "Stopped"}
          </div>
        </div>
      </section>

      <div className="workspace">
        <form className="panel form-panel" onSubmit={handleStart}>
          <div className="panel-heading">
            <Settings2 size={18} aria-hidden="true" />
            <h2>Search Setup</h2>
          </div>

          <label className="field">
            <span>Websites to Search</span>
            <textarea
              value={form.websites_to_search}
              onChange={(event) => updateForm("websites_to_search", event.target.value)}
              placeholder="rightmove.co.uk, zoopla.co.uk"
              rows={3}
            />
          </label>

          <label className="field">
            <span>Areas to Search</span>
            <textarea
              value={form.areas_to_search}
              onChange={(event) => updateForm("areas_to_search", event.target.value)}
              placeholder="Islington, Battersea, Canary Wharf"
              rows={3}
            />
          </label>

          <label className="field">
            <span>Property Criteria</span>
            <textarea
              value={form.property_criteria}
              onChange={(event) => updateForm("property_criteria", event.target.value)}
              placeholder="2 bed flat, under GBP 750k, near transport, low service charge"
              rows={4}
            />
          </label>

          <div className="field">
            <span>Update Frequency</span>
            <div className="segmented" role="radiogroup" aria-label="Update frequency">
              {FREQUENCY_OPTIONS.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  className={form.frequency === frequency ? "selected" : ""}
                  onClick={() => updateForm("frequency", frequency)}
                  aria-pressed={form.frequency === frequency}
                >
                  {frequency}
                </button>
              ))}
            </div>
          </div>

          <label className="field compact-field">
            <span>Time (UK)</span>
            <input
              value={form.run_time_uk}
              onChange={(event) => updateForm("run_time_uk", event.target.value)}
              placeholder="09:00"
              inputMode="numeric"
              maxLength={5}
              disabled={!requiresRunTime}
            />
          </label>
          {requiresRunTime && form.run_time_uk.trim() && !isValidRunTime ? (
            <p className="validation">Use 24-hour HH:MM format.</p>
          ) : null}

          <div className="panel-heading form-section-heading">
            <KeyRound size={18} aria-hidden="true" />
            <h2>OpenAI API</h2>
          </div>

          <div className="openai-guide">
            <p>
              Use your own OpenAI project key here. The agent sends searches to OpenAI's Responses API, and saved keys
              stay hidden after you submit the form.
            </p>
          </div>

          <div className="credential-grid">
            <label className="field">
              <span>Secret Key</span>
              <input
                type="password"
                value={form.openai_api_key}
                onChange={(event) => updateForm("openai_api_key", event.target.value)}
                placeholder={agentStatus?.config?.has_openai_api_key ? "Saved - leave blank to keep it" : "sk-..."}
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span>Model</span>
              <input
                value={form.model}
                onChange={(event) => updateForm("model", event.target.value)}
                placeholder="gpt-5"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="panel-heading form-section-heading">
            <MessageCircle size={18} aria-hidden="true" />
            <h2>Telegram</h2>
          </div>

          <div className="telegram-guide">
            <h3>Find your Telegram details</h3>
            <ol>
              <li>
                Open Telegram and start a chat with{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                  @BotFather
                </a>
                .
              </li>
              <li>
                Send <code>/newbot</code>, then choose a bot name and a username that ends in <code>bot</code>.
              </li>
              <li>Copy the token BotFather gives you and paste it into Bot Token.</li>
              <li>Open your new bot in Telegram, press Start, and send it any message.</li>
              <li>
                In your browser, open <code>https://api.telegram.org/botYOUR_TOKEN/getUpdates</code>,
                replacing <code>YOUR_TOKEN</code> with your bot token.
              </li>
              <li>
                Find <code>{'"chat":{"id":...}'}</code> in the response, copy that number, and paste it into Chat ID.
              </li>
            </ol>
            <p>
              Leave API Base URL as <code>https://api.telegram.org</code> unless you use a custom Telegram gateway. For
              a group chat, add the bot to the group, send a group message, then use the group chat ID from{" "}
              <code>getUpdates</code>.
            </p>
          </div>

          <div className="credential-grid">
            <label className="field">
              <span>Bot Token</span>
              <input
                type="password"
                value={form.telegram_bot_token}
                onChange={(event) => updateForm("telegram_bot_token", event.target.value)}
                placeholder={
                  agentStatus?.config?.has_telegram_bot_token
                    ? "Saved - leave blank to keep it"
                    : "123456789:ABC..."
                }
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span>Chat ID</span>
              <input
                value={form.telegram_chat_id}
                onChange={(event) => updateForm("telegram_chat_id", event.target.value)}
                placeholder="123456789"
                autoComplete="off"
              />
            </label>

            <label className="field full-span">
              <span>API Base URL</span>
              <input
                value={form.telegram_api_base_url}
                onChange={(event) => updateForm("telegram_api_base_url", event.target.value)}
                placeholder="https://api.telegram.org"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="actions">
            <button className="primary-button" type="submit" disabled={isSaving}>
              <Search size={17} aria-hidden="true" />
              {isSaving ? "Starting..." : "Set Search"}
            </button>
            <button className="secondary-button" type="button" onClick={handleCancel} disabled={isCancelling}>
              <CircleStop size={17} aria-hidden="true" />
              {isCancelling ? "Stopping" : "Cancel"}
            </button>
            <button className="icon-button" type="button" onClick={() => void loadStatus()} aria-label="Refresh status">
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>

          {message ? <p className="message">{message}</p> : null}
        </form>

        <section className="panel status-panel" aria-label="Agent status">
          <div className="panel-heading">
            <CalendarClock size={18} aria-hidden="true" />
            <h2>Status</h2>
          </div>
          <dl className="status-grid">
            <div>
              <dt>Frequency</dt>
              <dd>{agentStatus?.update_frequency_minutes ? frequencyLabel(agentStatus.update_frequency_minutes) : "Not set"}</dd>
            </div>
            <div>
              <dt>Next Run</dt>
              <dd>{formatNextRun(agentStatus?.next_run_at, isRunning)}</dd>
            </div>
            <div>
              <dt>Last Results</dt>
              <dd>{formatDateTime(agentStatus?.last_results_at)}</dd>
            </div>
            <div>
              <dt>Notification</dt>
              <dd>{agentStatus?.notification_channel ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{agentStatus?.recipient ?? "Not set"}</dd>
            </div>
          </dl>
          {agentStatus?.last_error ? (
            <p className="error-text">{agentStatus.last_error}</p>
          ) : isRunning && !agentStatus?.last_results_at ? (
            <p className="quiet-text">First search is running now.</p>
          ) : (
            <p className="quiet-text">Ready for the next run.</p>
          )}
        </section>
      </div>

      <section className="panel results-panel" aria-label="Latest property results">
        <div className="panel-heading results-heading">
          <Bell size={18} aria-hidden="true" />
          <h2>Latest Results</h2>
          <span>{agentStatus?.findings.length ?? 0}/10</span>
        </div>

        {agentStatus?.findings.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {tableColumns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentStatus.findings.map((finding) => (
                  <tr key={`${finding.rank}-${finding.listing_url}`}>
                    {tableColumns.map((column) => (
                      <td key={column.key}>
                        {column.key === "listing_url" ? (
                          <a href={finding.listing_url} target="_blank" rel="noreferrer">
                            Open <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : (
                          String(finding[column.key])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Search size={28} aria-hidden="true" />
            <p>No results yet.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function minutesToFrequency(minutes: number | null): FrequencyOption | null {
  if (minutes === null) {
    return null;
  }

  return FREQUENCY_OPTIONS.find((frequency) => frequencyToMinutes[frequency] === minutes) ?? null;
}

function frequencyLabel(minutes: number): string {
  return minutesToFrequency(minutes) ?? `${minutes} minutes`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function formatNextRun(value: string | null | undefined, isRunning: boolean): string {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  if (isRunning && date.getTime() <= Date.now()) {
    return "Running now";
  }

  return formatDateTime(value);
}

function storedAuthSession(): AuthResponse | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAuthResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return (
    isRecord(value) &&
    typeof value.session_token === "string" &&
    typeof value.expires_at === "string" &&
    isAuthUser(value.user)
  );
}

function isSessionPayload(value: unknown): value is { user: AuthUser } {
  return isRecord(value) && isAuthUser(value.user);
}

function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value) && typeof value.id === "string" && typeof value.username === "string";
}

function errorDetail(value: unknown): string | null {
  if (isRecord(value) && typeof value.detail === "string") {
    return value.detail;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
