import { ConfigError } from "./errors";
import type { NotificationChannel } from "./types";

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

export function getNotificationChannel(): NotificationChannel {
  const channel = cleanEnv(process.env.NOTIFICATION_CHANNEL) || "telegram";

  if (channel !== "telegram" && channel !== "email") {
    throw new ConfigError("NOTIFICATION_CHANNEL must be either telegram or email.");
  }

  return channel;
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

export function getSmtpConfig(): {
  host: string;
  port: number;
  useTls: boolean;
  authMethod: "none" | "basic" | "xoauth2";
  username: string;
  password: string;
  oauth2User: string;
  oauth2AccessToken: string;
  fromEmail: string;
  resultRecipient: string;
} {
  const host = cleanEnv(process.env.SMTP_HOST);
  const fromEmail = cleanEnv(process.env.SMTP_FROM_EMAIL);
  const resultRecipient = cleanEnv(process.env.SMTP_RESULT_RECIPIENT);
  const authMethod = cleanEnv(process.env.SMTP_AUTH_METHOD) || "basic";

  if (authMethod !== "none" && authMethod !== "basic" && authMethod !== "xoauth2") {
    throw new ConfigError("SMTP_AUTH_METHOD must be none, basic, or xoauth2.");
  }

  if (!host || !fromEmail || !resultRecipient) {
    throw new ConfigError("SMTP_HOST, SMTP_FROM_EMAIL, and SMTP_RESULT_RECIPIENT must be configured for email notifications.");
  }

  const username = cleanEnv(process.env.SMTP_USERNAME);
  const password = cleanEnv(process.env.SMTP_PASSWORD);
  const oauth2User = cleanEnv(process.env.SMTP_OAUTH2_USER) || username || fromEmail;
  const oauth2AccessToken = cleanEnv(process.env.SMTP_OAUTH2_ACCESS_TOKEN);

  if (authMethod === "basic" && username && !password) {
    throw new ConfigError("SMTP_PASSWORD must be configured when SMTP_AUTH_METHOD=basic and SMTP_USERNAME is set.");
  }

  if (authMethod === "xoauth2" && (!oauth2User || !oauth2AccessToken)) {
    throw new ConfigError("SMTP_OAUTH2_USER and SMTP_OAUTH2_ACCESS_TOKEN must be configured for xoauth2 auth.");
  }

  return {
    host,
    port: Number.parseInt(cleanEnv(process.env.SMTP_PORT) || "587", 10),
    useTls: (cleanEnv(process.env.SMTP_USE_TLS) || "true").toLowerCase() === "true",
    authMethod,
    username,
    password,
    oauth2User,
    oauth2AccessToken,
    fromEmail,
    resultRecipient,
  };
}
