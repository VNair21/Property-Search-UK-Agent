import {
  AGENT_CONFIG_KEY,
  AGENT_LOCK_KEY,
  AGENT_LOCK_TTL_SECONDS,
  AGENT_RESULTS_KEY,
  AGENT_STATE_KEY,
} from "./constants";
import { messageFromUnknown } from "./errors";
import { runPropertySearch } from "./openai";
import { sendResults, validateNotificationSettings } from "./notifications";
import { createRedisClient } from "./redis";
import { computeNextRunAt, isDueForRun } from "./schedule";
import type {
  PropertyAgentConfig,
  PropertyAgentSetResponse,
  PropertyAgentStatusResponse,
  StoredAgentState,
  StoredSearchResults,
} from "./types";
import { configFromRequest } from "./validation";

type ScheduledRunResult =
  | {
      status: "ran";
      findings: number;
      next_run_at: string;
    }
  | {
      status: "skipped";
      reason: "not_configured" | "stopped" | "not_due" | "locked";
      next_run_at?: string | null;
    };

export async function configureAndStartAgent(requestBody: unknown): Promise<PropertyAgentSetResponse> {
  const config = configFromRequest(requestBody);
  const notification = validateNotificationSettings();
  const now = new Date();
  const state: StoredAgentState = {
    status: "running",
    last_run_at: null,
    next_run_at: now.toISOString(),
    last_error: null,
    last_error_at: null,
    updated_at: now.toISOString(),
    notification_channel: notification.channel,
    recipient: notification.recipient,
  };

  const redis = createRedisClient();
  await redis.pipeline([
    ["SET", AGENT_CONFIG_KEY, JSON.stringify(config)],
    ["DEL", AGENT_RESULTS_KEY],
    ["SET", AGENT_STATE_KEY, JSON.stringify(state)],
  ]);

  return {
    status: "running",
    model: config.model,
    update_frequency_minutes: config.update_frequency_minutes,
    run_time_uk: config.run_time_uk,
    next_run_at: state.next_run_at,
    notification_channel: notification.channel,
    recipient: notification.recipient,
    findings: [],
    table_markdown: "",
  };
}

export async function getAgentStatus(): Promise<PropertyAgentStatusResponse> {
  const redis = createRedisClient();
  const [config, state, results] = await Promise.all([
    redis.getJson<PropertyAgentConfig>(AGENT_CONFIG_KEY),
    redis.getJson<StoredAgentState>(AGENT_STATE_KEY),
    redis.getJson<StoredSearchResults>(AGENT_RESULTS_KEY),
  ]);

  return {
    is_running: state?.status === "running",
    update_frequency_minutes: config?.update_frequency_minutes ?? null,
    run_time_uk: config?.run_time_uk ?? null,
    model: config?.model ?? null,
    last_results_at: results?.timestamp ?? null,
    next_run_at: state?.next_run_at ?? null,
    last_error: state?.last_error ?? null,
    notification_channel: state?.notification_channel ?? null,
    recipient: state?.recipient ?? null,
    config: config ?? null,
    findings: results?.findings ?? [],
  };
}

export async function cancelAgent(): Promise<{ status: "stopped" }> {
  const redis = createRedisClient();
  const currentState = await redis.getJson<StoredAgentState>(AGENT_STATE_KEY);
  const now = new Date().toISOString();

  await redis.setJson(AGENT_STATE_KEY, {
    status: "stopped",
    last_run_at: currentState?.last_run_at ?? null,
    next_run_at: null,
    last_error: null,
    last_error_at: null,
    updated_at: now,
    notification_channel: currentState?.notification_channel ?? null,
    recipient: currentState?.recipient ?? null,
  } satisfies StoredAgentState);

  return { status: "stopped" };
}

export async function runScheduledAgent(): Promise<ScheduledRunResult> {
  const redis = createRedisClient();
  const lockToken = crypto.randomUUID();
  const hasLock = await redis.setIfAbsent(AGENT_LOCK_KEY, lockToken, AGENT_LOCK_TTL_SECONDS);

  if (!hasLock) {
    return {
      status: "skipped",
      reason: "locked",
    };
  }

  try {
    const [config, state] = await Promise.all([
      redis.getJson<PropertyAgentConfig>(AGENT_CONFIG_KEY),
      redis.getJson<StoredAgentState>(AGENT_STATE_KEY),
    ]);

    if (!config) {
      return {
        status: "skipped",
        reason: "not_configured",
      };
    }

    if (state?.status !== "running") {
      return {
        status: "skipped",
        reason: "stopped",
        next_run_at: state?.next_run_at ?? null,
      };
    }

    if (!isDueForRun(state)) {
      return {
        status: "skipped",
        reason: "not_due",
        next_run_at: state.next_run_at,
      };
    }

    validateNotificationSettings();
    const run = await runPropertySearch(config);
    const notification = await sendResults(run.findings, config);
    const now = new Date();
    const nextRunAt = computeNextRunAt(config, now).toISOString();
    const nextState: StoredAgentState = {
      status: "running",
      last_run_at: now.toISOString(),
      next_run_at: nextRunAt,
      last_error: null,
      last_error_at: null,
      updated_at: now.toISOString(),
      notification_channel: notification.channel,
      recipient: notification.recipient,
    };

    await redis.pipeline([
      [
        "SET",
        AGENT_RESULTS_KEY,
        JSON.stringify({
          timestamp: now.toISOString(),
          findings: run.findings,
          table_markdown: run.tableMarkdown,
        } satisfies StoredSearchResults),
      ],
      ["SET", AGENT_STATE_KEY, JSON.stringify(nextState)],
    ]);

    return {
      status: "ran",
      findings: run.findings.length,
      next_run_at: nextRunAt,
    };
  } catch (error) {
    await storeScheduledError(redis, error);
    throw error;
  } finally {
    await releaseLock(redis, lockToken);
  }
}

async function storeScheduledError(redis: ReturnType<typeof createRedisClient>, error: unknown): Promise<void> {
  const currentState = await redis.getJson<StoredAgentState>(AGENT_STATE_KEY);
  const config = await redis.getJson<PropertyAgentConfig>(AGENT_CONFIG_KEY);
  const now = new Date();

  await redis.setJson(AGENT_STATE_KEY, {
    status: currentState?.status ?? "stopped",
    last_run_at: currentState?.last_run_at ?? null,
    next_run_at: config ? computeNextRunAt(config, now).toISOString() : (currentState?.next_run_at ?? null),
    last_error: messageFromUnknown(error),
    last_error_at: now.toISOString(),
    updated_at: now.toISOString(),
    notification_channel: currentState?.notification_channel ?? null,
    recipient: currentState?.recipient ?? null,
  } satisfies StoredAgentState);
}

async function releaseLock(redis: ReturnType<typeof createRedisClient>, lockToken: string): Promise<void> {
  const currentToken = await redis.getString(AGENT_LOCK_KEY);
  if (currentToken === lockToken) {
    await redis.delete(AGENT_LOCK_KEY);
  }
}
