import nodemailer from "nodemailer";

import { getNotificationChannel, getSmtpConfig, getTelegramConfig } from "./config";
import { splitForTelegram, toTelegramMessage, wrapTelegramChunk } from "./format";
import type { NotificationChannel, PropertyAgentConfig, PropertyFinding } from "./types";

export async function sendResults(
  findings: PropertyFinding[],
  tableMarkdown: string,
  config: PropertyAgentConfig,
): Promise<{ channel: NotificationChannel; recipient: string }> {
  const channel = getNotificationChannel();

  if (channel === "email") {
    const recipient = await sendEmail(findings, tableMarkdown, config);
    return { channel, recipient };
  }

  const recipient = await sendTelegram(findings, config);
  return { channel, recipient };
}

export function validateNotificationSettings(): void {
  const channel = getNotificationChannel();

  if (channel === "email") {
    getSmtpConfig();
    return;
  }

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

async function sendEmail(
  findings: PropertyFinding[],
  tableMarkdown: string,
  config: PropertyAgentConfig,
): Promise<string> {
  const smtp = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.useTls && smtp.port === 465,
    requireTLS: smtp.useTls && smtp.port !== 465,
    auth: authForSmtp(smtp),
  });

  await transporter.sendMail({
    from: smtp.fromEmail,
    to: smtp.resultRecipient,
    subject: "Property Search Agent Results",
    text: [
      "Property Search Agent Results",
      `Model: ${config.model}`,
      `Websites: ${config.websites_to_search.join(", ")}`,
      `Areas: ${config.areas_to_search.join(", ")}`,
      `Criteria: ${config.property_criteria}`,
      `Results: ${findings.length}`,
      "",
      tableMarkdown,
    ].join("\n"),
  });

  return smtp.resultRecipient;
}

function authForSmtp(smtp: ReturnType<typeof getSmtpConfig>) {
  if (smtp.authMethod === "none") {
    return undefined;
  }

  if (smtp.authMethod === "xoauth2") {
    return {
      type: "OAuth2" as const,
      user: smtp.oauth2User,
      accessToken: smtp.oauth2AccessToken,
    };
  }

  if (!smtp.username) {
    return undefined;
  }

  return {
    user: smtp.username,
    pass: smtp.password,
  };
}
