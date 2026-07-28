import { getTelegramConfig } from "./config";
import { splitForTelegram, toTelegramMessage, wrapTelegramChunk } from "./format";
import type { NotificationChannel, PropertyAgentConfig, PropertyFinding } from "./types";

export async function sendResults(
  findings: PropertyFinding[],
  config: PropertyAgentConfig,
): Promise<{ channel: NotificationChannel; recipient: string }> {
  const recipient = await sendTelegram(findings, config);
  return { channel: "telegram", recipient };
}

export function validateNotificationSettings(): void {
  getTelegramConfig();
}

async function sendTelegram(findings: PropertyFinding[], config: PropertyAgentConfig): Promise<string> {
  const telegram = getTelegramConfig();
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
