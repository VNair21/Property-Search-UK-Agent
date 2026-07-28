"use client";

import {
  Bell,
  CalendarClock,
  CircleStop,
  ExternalLink,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  FREQUENCY_OPTIONS,
  frequencyToMinutes,
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
};

const defaultFormState: FormState = {
  websites_to_search: "",
  areas_to_search: "",
  property_criteria: "",
  frequency: "Daily",
  run_time_uk: "09:00",
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
  const [agentStatus, setAgentStatus] = useState<PropertyAgentStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState<string>("");

  const selectedMinutes = frequencyToMinutes[form.frequency];
  const requiresRunTime = form.frequency !== "Hourly";
  const isValidRunTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(form.run_time_uk.trim());
  const isRunning = agentStatus?.is_running ?? false;

  const loadStatus = useCallback(async (syncForm = false) => {
    setIsLoadingStatus(true);
    try {
      const response = await fetch("/api/property-agent/status", { cache: "no-store" });
      const payload = (await response.json()) as unknown;
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
        });
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  const statusTone = useMemo(() => {
    if (isLoadingStatus) {
      return "neutral";
    }

    return isRunning ? "running" : "stopped";
  }, [isLoadingStatus, isRunning]);

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (requiresRunTime && !isValidRunTime) {
      setMessage("Enter Time (UK) in HH:MM format.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/property-agent/set-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websites_to_search: form.websites_to_search,
          areas_to_search: form.areas_to_search,
          property_criteria: form.property_criteria,
          update_frequency_minutes: selectedMinutes,
          run_time_uk: requiresRunTime ? form.run_time_uk.trim() : null,
        }),
      });
      const payload = (await response.json()) as { detail?: string };

      if (!response.ok) {
        throw new Error(payload.detail ?? "Failed to start property agent.");
      }

      setMessage("Search saved and first run completed.");
      await loadStatus(false);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    setMessage("");

    try {
      const response = await fetch("/api/property-agent/cancel", { method: "POST" });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Failed to cancel property agent.");
      }

      setMessage("Property agent stopped.");
      await loadStatus(false);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsCancelling(false);
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Agent overview">
        <div>
          <p className="eyebrow">Vercel property monitor</p>
          <h1>Agentic Wealth Manager</h1>
        </div>
        <div className={`status-chip ${statusTone}`}>
          <span aria-hidden="true" />
          {isLoadingStatus ? "Checking" : isRunning ? "Running" : "Stopped"}
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

          <div className="actions">
            <button className="primary-button" type="submit" disabled={isSaving}>
              <Search size={17} aria-hidden="true" />
              {isSaving ? "Running" : "Set Search"}
            </button>
            <button className="secondary-button" type="button" onClick={handleCancel} disabled={isCancelling}>
              <CircleStop size={17} aria-hidden="true" />
              {isCancelling ? "Stopping" : "Cancel"}
            </button>
            <button className="icon-button" type="button" onClick={() => void loadStatus(false)} aria-label="Refresh status">
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
              <dd>{formatDateTime(agentStatus?.next_run_at)}</dd>
            </div>
            <div>
              <dt>Last Results</dt>
              <dd>{formatDateTime(agentStatus?.last_results_at)}</dd>
            </div>
            <div>
              <dt>Notification</dt>
              <dd>{agentStatus?.notification_channel ?? "Not set"}</dd>
            </div>
          </dl>
          {agentStatus?.last_error ? (
            <p className="error-text">{agentStatus.last_error}</p>
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

function errorDetail(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "detail" in value && typeof value.detail === "string") {
    return value.detail;
  }

  return null;
}
