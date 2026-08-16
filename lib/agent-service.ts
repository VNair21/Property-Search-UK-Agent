import { AGENT_LOCK_TTL_SECONDS, RUNNING_AGENT_USER_IDS_KEY, agentKeysForUser } from "./constants";
import { messageFromUnknown } from "./errors";
import { runPropertySearch } from "./openai";
import { sendResults, validateNotificationSettings } from "./notifications";
import { createRedisClient } from "./redis";
import { computeNextRunAt, isDueForRun } from "./schedule";
import type {
  NotificationChannel,
  OpenAIProviderConfig,
  PropertyAgentConfig,
  PropertyAgentPublicConfig,
  PropertyAgentSetResponse,
  PropertyAgentStatusResponse,
  StoredAgentState,
  StoredSearchResults,
  TelegramNotificationConfig,
} from "./types";
import { configFromRequest } from "./validation";

type ScheduledRunResult =
  | {
      user_id: string;
      status: "ran";
      findings: number;
      next_run_at: string;
    }
  | {
      user_id: string;
      status: "skipped";
      reason: "not_configured" | "stopped" | "not_due" | "locked";
      next_run_at?: string | null;
    };

type ScheduledRunBatchResult = {
  status: "completed";
  users_checked: number;
  results: Array<ScheduledRunResult | { user_id: string; status: "error"; error: string }>;
};

export async function configureAndStartAgent(
  requestBody: unknown,
  userId: string,
): Promise<PropertyAgentSetResponse> {
  const redis = createRedisClient();
  const keys = agentKeysForUser(userId);
  const previousConfig = await redis.getJson<PropertyAgentConfig>(keys.config);
  const config = configFromRequest(requestBody, previousConfig);
  const notification = validateNotificationSettings(config);
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

  await redis.pipeline([
    ["SET", keys.config, JSON.stringify(config)],
    ["DEL", keys.results],
    ["SET", keys.state, JSON.stringify(state)],
    ["SADD", RUNNING_AGENT_USER_IDS_KEY, userId],
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

export async function getAgentStatus(userId: string): Promise<PropertyAgentStatusResponse> {
  const redis = createRedisClient();
  const keys = agentKeysForUser(userId);
  const [config, state, results] = await Promise.all([
    redis.getJson<PropertyAgentConfig>(keys.config),
    redis.getJson<StoredAgentState>(keys.state),
    redis.getJson<StoredSearchResults>(keys.results),
  ]);
  const notification = notificationFromConfig(config);

  return {
    is_running: state?.status === "running",
    update_frequency_minutes: config?.update_frequency_minutes ?? null,
    run_time_uk: config?.run_time_uk ?? null,
    model: config?.model ?? null,
    last_results_at: results?.timestamp ?? null,
    next_run_at: state?.next_run_at ?? null,
    last_error: state?.last_error ?? null,
    notification_channel: state?.notification_channel ?? notification?.channel ?? null,
    recipient: state?.recipient ?? notification?.chatId ?? null,
    config: config ? publicConfigFromConfig(config) : null,
    findings: results?.findings ?? [],
  };
}

export async function cancelAgent(userId: string): Promise<{ status: "stopped" }> {
  const redis = createRedisClient();
  const keys = agentKeysForUser(userId);
  const [currentState, config] = await Promise.all([
    redis.getJson<StoredAgentState>(keys.state),
    redis.getJson<PropertyAgentConfig>(keys.config),
  ]);
  const notification = notificationFromConfig(config);
  const now = new Date().toISOString();

  await redis.pipeline([
    [
      "SET",
      keys.state,
      JSON.stringify({
        status: "stopped",
        last_run_at: currentState?.last_run_at ?? null,
        next_run_at: null,
        last_error: null,
        last_error_at: null,
        updated_at: now,
        notification_channel: currentState?.notification_channel ?? notification?.channel ?? null,
        recipient: currentState?.recipient ?? notification?.chatId ?? null,
      } satisfies StoredAgentState),
    ],
    ["SREM", RUNNING_AGENT_USER_IDS_KEY, userId],
  ]);

  return { status: "stopped" };
}

export async function runScheduledAgents(): Promise<ScheduledRunBatchResult> {
  const redis = createRedisClient();
  const userIds = await redis.getSetMembers(RUNNING_AGENT_USER_IDS_KEY);
  const results: ScheduledRunBatchResult["results"] = [];

  for (const userId of userIds) {
    try {
      results.push(await runScheduledAgentForUser(userId));
    } catch (error) {
      results.push({
        user_id: userId,
        status: "error",
        error: messageFromUnknown(error),
      });
    }
  }

  return {
    status: "completed",
    users_checked: userIds.length,
    results,
  };
}

export async function runScheduledAgentForUser(userId: string): Promise<ScheduledRunResult> {
  const redis = createRedisClient();
  const keys = agentKeysForUser(userId);
  const lockToken = crypto.randomUUID();
  const hasLock = await redis.setIfAbsent(keys.lock, lockToken, AGENT_LOCK_TTL_SECONDS);

  if (!hasLock) {
    return {
      user_id: userId,
      status: "skipped",
      reason: "locked",
    };
  }

  try {
    const [config, state] = await Promise.all([
      redis.getJson<PropertyAgentConfig>(keys.config),
      redis.getJson<StoredAgentState>(keys.state),
    ]);

    if (!config) {
      await redis.removeFromSet(RUNNING_AGENT_USER_IDS_KEY, userId);
      return {
        user_id: userId,
        status: "skipped",
        reason: "not_configured",
      };
    }

    if (state?.status !== "running") {
      await redis.removeFromSet(RUNNING_AGENT_USER_IDS_KEY, userId);
      return {
        user_id: userId,
        status: "skipped",
        reason: "stopped",
        next_run_at: state?.next_run_at ?? null,
      };
    }

    if (!isDueForRun(state)) {
      return {
        user_id: userId,
        status: "skipped",
        reason: "not_due",
        next_run_at: state.next_run_at,
      };
    }

    validateNotificationSettings(config);
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
        keys.results,
        JSON.stringify({
          timestamp: now.toISOString(),
          findings: run.findings,
          table_markdown: run.tableMarkdown,
        } satisfies StoredSearchResults),
      ],
      ["SET", keys.state, JSON.stringify(nextState)],
    ]);

    return {
      user_id: userId,
      status: "ran",
      findings: run.findings.length,
      next_run_at: nextRunAt,
    };
  } catch (error) {
    await storeScheduledError(redis, userId, error);
    throw error;
  } finally {
    await releaseLock(redis, userId, lockToken);
  }
}

async function storeScheduledError(
  redis: ReturnType<typeof createRedisClient>,
  userId: string,
  error: unknown,
): Promise<void> {
  const keys = agentKeysForUser(userId);
  const [currentState, config] = await Promise.all([
    redis.getJson<StoredAgentState>(keys.state),
    redis.getJson<PropertyAgentConfig>(keys.config),
  ]);
  const notification = notificationFromConfig(config);
  const now = new Date();

  await redis.setJson(keys.state, {
    status: currentState?.status ?? "stopped",
    last_run_at: currentState?.last_run_at ?? null,
    next_run_at: config ? computeNextRunAt(config, now).toISOString() : (currentState?.next_run_at ?? null),
    last_error: messageFromUnknown(error),
    last_error_at: now.toISOString(),
    updated_at: now.toISOString(),
    notification_channel: currentState?.notification_channel ?? notification?.channel ?? null,
    recipient: currentState?.recipient ?? notification?.chatId ?? null,
  } satisfies StoredAgentState);
}

async function releaseLock(
  redis: ReturnType<typeof createRedisClient>,
  userId: string,
  lockToken: string,
): Promise<void> {
  const keys = agentKeysForUser(userId);
  const currentToken = await redis.getString(keys.lock);
  if (currentToken === lockToken) {
    await redis.delete(keys.lock);
  }
}

function publicConfigFromConfig(config: PropertyAgentConfig): PropertyAgentPublicConfig {
  const notification = notificationFromConfig(config);
  const openai = openAIFromConfig(config);

  return {
    websites_to_search: config.websites_to_search,
    areas_to_search: config.areas_to_search,
    property_criteria: config.property_criteria,
    update_frequency_minutes: config.update_frequency_minutes,
    run_time_uk: config.run_time_uk,
    model: config.model,
    openai_api_endpoint: openai?.endpoint ?? null,
    has_openai_api_key: Boolean(openai?.apiKey),
    telegram_chat_id: notification?.chatId ?? null,
    telegram_api_base_url: notification?.apiBaseUrl ?? null,
    has_telegram_bot_token: Boolean(notification?.botToken),
  };
}

function openAIFromConfig(config: PropertyAgentConfig | null | undefined): OpenAIProviderConfig | null {
  return config?.openai ?? null;
}

function notificationFromConfig(config: PropertyAgentConfig | null | undefined): TelegramNotificationConfig | null {
  return config?.notification ?? null;
}
