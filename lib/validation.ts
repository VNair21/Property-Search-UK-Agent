import { getDefaultOpenAIModel, getOptionalTelegramConfig } from "./config";
import { ValidationError } from "./errors";
import type {
  AgentCredentialsRequest,
  OpenAIProviderConfig,
  PropertyAgentConfig,
  PropertyAgentSetRequest,
  PropertyFinding,
  StoredAgentCredentials,
  TelegramNotificationConfig,
} from "./types";

const UK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function configFromRequest(
  input: unknown,
  previousConfig?: PropertyAgentConfig | null,
  previousCredentials?: StoredAgentCredentials | null,
): PropertyAgentConfig {
  if (!isRecord(input)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const request: PropertyAgentSetRequest = {
    websites_to_search: requiredString(input.websites_to_search, "websites_to_search"),
    areas_to_search: requiredString(input.areas_to_search, "areas_to_search"),
    property_criteria: requiredString(input.property_criteria, "property_criteria"),
    update_frequency_minutes: requiredInteger(input.update_frequency_minutes, "update_frequency_minutes"),
    run_time_uk: optionalString(input.run_time_uk),
    model: optionalString(input.model),
    openai_api_key: optionalString(input.openai_api_key),
    telegram_bot_token: optionalString(input.telegram_bot_token),
    telegram_chat_id: optionalString(input.telegram_chat_id),
    telegram_api_base_url: optionalString(input.telegram_api_base_url),
  };

  const websites = splitList(request.websites_to_search, "websites_to_search");
  const areas = splitList(request.areas_to_search, "areas_to_search");
  const criteria = request.property_criteria.trim();
  const runTimeUk = request.run_time_uk?.trim() || null;
  const model = request.model?.trim() || previousConfig?.model || getDefaultOpenAIModel();

  if (!criteria) {
    throw new ValidationError("Property criteria cannot be empty.");
  }

  if (request.update_frequency_minutes < 15) {
    throw new ValidationError("Update frequency must be at least 15 minutes.");
  }

  if (runTimeUk && !UK_TIME_PATTERN.test(runTimeUk)) {
    throw new ValidationError("Time (UK) must use 24-hour format HH:MM.");
  }

  if (request.update_frequency_minutes % (24 * 60) === 0 && !runTimeUk) {
    throw new ValidationError("Time (UK) is required for daily, weekly, and monthly schedules.");
  }

  return {
    websites_to_search: websites,
    areas_to_search: areas,
    property_criteria: criteria,
    update_frequency_minutes: request.update_frequency_minutes,
    run_time_uk: runTimeUk,
    model,
    openai: openAIProviderFromRequest(request, previousOpenAIProvider(previousConfig, previousCredentials)),
    notification: telegramNotificationFromRequest(
      request,
      previousTelegramConfig(previousConfig, previousCredentials),
    ),
  };
}

export function credentialsFromRequest(
  input: unknown,
  previousCredentials?: StoredAgentCredentials | null,
): StoredAgentCredentials {
  if (!isRecord(input)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const request: AgentCredentialsRequest = {
    openai_api_key: optionalString(input.openai_api_key),
    telegram_bot_token: optionalString(input.telegram_bot_token),
    telegram_chat_id: optionalString(input.telegram_chat_id),
    telegram_api_base_url: optionalString(input.telegram_api_base_url),
  };
  const telegramApiBaseUrl = request.telegram_api_base_url ?? previousCredentials?.telegram_api_base_url ?? null;

  if (telegramApiBaseUrl && !/^https?:\/\//i.test(telegramApiBaseUrl)) {
    throw new ValidationError("Telegram API base URL must start with http:// or https://.");
  }

  return {
    openai_api_key: request.openai_api_key ?? previousCredentials?.openai_api_key ?? null,
    telegram_bot_token: request.telegram_bot_token ?? previousCredentials?.telegram_bot_token ?? null,
    telegram_chat_id: request.telegram_chat_id ?? previousCredentials?.telegram_chat_id ?? null,
    telegram_api_base_url: telegramApiBaseUrl,
    updated_at: new Date().toISOString(),
  };
}

export function validateFindings(input: unknown): PropertyFinding[] {
  if (!isRecord(input) || !Array.isArray(input.findings)) {
    throw new ValidationError("Model response did not include a findings array.");
  }

  return input.findings.slice(0, 10).map((finding, index) => normalizeFinding(finding, index + 1));
}

function normalizeFinding(input: unknown, fallbackRank: number): PropertyFinding {
  if (!isRecord(input)) {
    throw new ValidationError("Model response included an invalid finding.");
  }

  const listingUrl = requiredString(input.listing_url, "listing_url").trim();
  if (!/^https?:\/\//i.test(listingUrl)) {
    throw new ValidationError("Every finding must include a valid HTTP listing URL.");
  }

  return {
    rank: normalizedRank(input.rank, fallbackRank),
    property: requiredString(input.property, "property"),
    price: requiredString(input.price, "price"),
    size_sqm: requiredString(input.size_sqm, "size_sqm"),
    pounds_per_sqm: requiredString(input.pounds_per_sqm, "pounds_per_sqm"),
    service_charge: requiredString(input.service_charge, "service_charge"),
    ground_rent: requiredString(input.ground_rent, "ground_rent"),
    location: requiredString(input.location, "location"),
    key_strengths: requiredString(input.key_strengths, "key_strengths"),
    main_issues: requiredString(input.main_issues, "main_issues"),
    listing_url: listingUrl,
  };
}

function splitList(value: string, fieldName: string): string[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new ValidationError(`${fieldName} must include at least one non-empty value.`);
  }

  return values;
}

function normalizedRank(value: unknown, fallbackRank: number): number {
  const rank = Number(value);
  if (Number.isInteger(rank) && rank >= 1 && rank <= 10) {
    return rank;
  }

  return fallbackRank;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  throw new ValidationError(`${fieldName} is required.`);
}

function previousOpenAIProvider(
  previousConfig: PropertyAgentConfig | null | undefined,
  previousCredentials: StoredAgentCredentials | null | undefined,
): OpenAIProviderConfig | null {
  const apiKey = previousCredentials?.openai_api_key ?? previousConfig?.openai?.apiKey ?? "";

  return apiKey ? { apiKey } : null;
}

function openAIProviderFromRequest(
  request: Pick<PropertyAgentSetRequest, "openai_api_key">,
  previous: OpenAIProviderConfig | null,
): OpenAIProviderConfig {
  const apiKey = request.openai_api_key ?? previous?.apiKey ?? "";

  if (!apiKey) {
    throw new ValidationError("OpenAI API key is required.");
  }

  return {
    apiKey,
  };
}

function previousTelegramConfig(
  previousConfig: PropertyAgentConfig | null | undefined,
  previousCredentials: StoredAgentCredentials | null | undefined,
): TelegramNotificationConfig | null {
  const envTelegram = getOptionalTelegramConfig();
  const fallback = previousConfig?.notification ?? envTelegram;
  const botToken = previousCredentials?.telegram_bot_token ?? fallback?.botToken ?? "";
  const chatId = previousCredentials?.telegram_chat_id ?? fallback?.chatId ?? "";
  const apiBaseUrl =
    previousCredentials?.telegram_api_base_url ?? fallback?.apiBaseUrl ?? "https://api.telegram.org";

  return {
    channel: "telegram",
    botToken,
    chatId,
    apiBaseUrl,
  };
}

function telegramNotificationFromRequest(
  request: Pick<PropertyAgentSetRequest, "telegram_bot_token" | "telegram_chat_id" | "telegram_api_base_url">,
  previous: TelegramNotificationConfig | null,
): TelegramNotificationConfig {
  const botToken = request.telegram_bot_token ?? previous?.botToken ?? "";
  const chatId = request.telegram_chat_id ?? previous?.chatId ?? "";
  const apiBaseUrl = (request.telegram_api_base_url ?? previous?.apiBaseUrl ?? "https://api.telegram.org").replace(
    /\/$/,
    "",
  );

  if (!botToken || !chatId) {
    throw new ValidationError("Telegram bot token and chat ID are required.");
  }

  if (!/^https?:\/\//i.test(apiBaseUrl)) {
    throw new ValidationError("Telegram API base URL must start with http:// or https://.");
  }

  return {
    channel: "telegram",
    botToken,
    chatId,
    apiBaseUrl,
  };
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  return String(value).trim() || null;
}

function requiredInteger(value: unknown, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${fieldName} must be an integer.`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
