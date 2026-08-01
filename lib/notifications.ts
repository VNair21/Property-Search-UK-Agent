import { getTelegramConfig } from "./config";
import { splitForTelegram, toTelegramMessage, wrapTelegramChunk } from "./format";
import type { NotificationChannel, PropertyAgentConfig, PropertyFinding, TelegramNotificationConfig } from "./types";

export async function sendResults(
  findings: PropertyFinding[],
  config: PropertyAgentConfig,
): Promise<{ channel: NotificationChannel; recipient: string }> {
  const recipient = await sendTelegram(findings, config);
  return { channel: "telegram", recipient };
}

export function validateNotificationSettings(config?: PropertyAgentConfig | null): {
  channel: NotificationChannel;
  recipient: string;
} {
  const telegram = resolveTelegramConfig(config);
  return { channel: "telegram", recipient: telegram.chatId };
}

async function sendTelegram(findings: PropertyFinding[], config: PropertyAgentConfig): Promise<string> {
  const telegram = resolveTelegramConfig(config);
  const endpoint = `${telegram.apiBaseUrl.replace(/\/$/, "")}/bot${telegram.botToken}/sendMessage`;
  const chunks = splitForTelegram(toTelegramMessage(findings, config));

  for (const [index, chunk] of chunks.entries()) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        chat_id: telegram.chatId,
        text: wrapTelegramChunk(chunk, index, chunks.length),
        parse_mode: "HTML",
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as { ok?: boolean; description?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(`Telegram API error: ${payload.description ?? response.statusText}`);
    }
  }

  return telegram.chatId;
}

function resolveTelegramConfig(config?: PropertyAgentConfig | null): TelegramNotificationConfig {
  return config?.notification ?? getTelegramConfig();
}
