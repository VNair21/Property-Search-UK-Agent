import { ConfigError } from "./errors";

export function cleanEnv(value: string | undefined): string {
  return value?.trim() ?? "";
}

export type RedisConnectionConfig =
  | {
      provider: "redis-url";
      url: string;
    }
  | {
      provider: "rest";
      url: string;
      token: string;
    };

export function getRedisConnectionConfig(): RedisConnectionConfig {
  const redisUrl = cleanEnv(process.env.REDIS_URL) || cleanEnv(process.env.REDISCLOUD_URL);
  if (redisUrl) {
    return {
      provider: "redis-url",
      url: redisUrl,
    };
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL) || cleanEnv(process.env.KV_REST_API_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN) || cleanEnv(process.env.KV_REST_API_TOKEN);

  if (!url || !token) {
    throw new ConfigError("Redis credentials are missing. For Redis Cloud, set REDIS_URL. For Upstash REST, set KV_REST_API_URL and KV_REST_API_TOKEN, or the UPSTASH_REDIS_REST_* equivalents.");
  }

  return {
    provider: "rest",
    url: url.replace(/\/$/, ""),
    token,
  };
}

export function getOpenAIConfig(): { apiKey: string; defaultModel: string } {
  const apiKey = cleanEnv(process.env.OPENAI_API_KEY);

  if (!apiKey) {
    throw new ConfigError("OPENAI_API_KEY must be configured.");
  }

  return {
    apiKey,
    defaultModel: cleanEnv(process.env.DEFAULT_OPENAI_MODEL) || "gpt-5",
  };
}

export function getTelegramConfig(): {
  botToken: string;
  chatId: string;
  apiBaseUrl: string;
} {
  const botToken = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
  const chatId = cleanEnv(process.env.TELEGRAM_CHAT_ID);

  if (!botToken || !chatId) {
    throw new ConfigError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured for Telegram notifications.");
  }

  return {
    botToken,
    chatId,
    apiBaseUrl: cleanEnv(process.env.TELEGRAM_API_BASE_URL) || "https://api.telegram.org",
  };
}
