import type { PropertyFinding, PropertyAgentConfig } from "./types";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function toMarkdownTable(findings: PropertyFinding[]): string {
  const header = [
    "Rank",
    "Property",
    "Price",
    "Size (sqm)",
    "GBP/sqm",
    "Service Charge",
    "Ground Rent",
    "Location",
    "Key Strengths",
    "Main Issues",
    "Listing URL",
  ];
  const divider = header.map(() => "---");
  const rows = findings.map((finding) => [
    finding.rank,
    finding.property,
    finding.price,
    finding.size_sqm,
    finding.pounds_per_sqm,
    finding.service_charge,
    finding.ground_rent,
    finding.location,
    finding.key_strengths,
    finding.main_issues,
    finding.listing_url,
  ]);

  return [header, divider, ...rows]
    .map((row) => `| ${row.map((value) => escapeMarkdownCell(String(value))).join(" | ")} |`)
    .join("\n");
}

export function toTelegramMessage(findings: PropertyFinding[], config: PropertyAgentConfig): string {
  return [
    "<b>Property Search Agent Results</b>",
    `<b>Model:</b> ${escapeTelegramHtml(config.model)}`,
    `<b>Websites:</b> ${escapeTelegramHtml(config.websites_to_search.join(", "))}`,
    `<b>Areas:</b> ${escapeTelegramHtml(config.areas_to_search.join(", "))}`,
    `<b>Criteria:</b> ${escapeTelegramHtml(config.property_criteria)}`,
    "",
    toTelegramFindings(findings),
  ].join("\n");
}

export function splitForTelegram(text: string): string[] {
  const chunks = splitByEscapedLength(text, TELEGRAM_MAX_MESSAGE_LENGTH);
  if (chunks.length === 1) {
    return chunks;
  }

  let previousCount = -1;
  let currentChunks = chunks;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const totalParts = currentChunks.length;
    const maxPrefixLength = Math.max(
      ...currentChunks.map((_, index) => `<b>(Part ${index + 1}/${totalParts})</b>\n`.length),
    );
    currentChunks = splitByEscapedLength(text, TELEGRAM_MAX_MESSAGE_LENGTH - maxPrefixLength);

    if (currentChunks.length === previousCount) {
      break;
    }

    previousCount = currentChunks.length;
  }

  return currentChunks;
}

export function wrapTelegramChunk(text: string, index: number, total: number): string {
  if (total === 1) {
    return text;
  }

  return `<b>(Part ${index + 1}/${total})</b>\n${text}`;
}

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toTelegramFindings(findings: PropertyFinding[]): string {
  if (findings.length === 0) {
    return "No results returned.";
  }

  return findings
    .map((finding) => [
      `<b>#${finding.rank} - ${cleanForTelegram(finding.property)}</b>`,
      `<b>Price:</b> ${cleanForTelegram(finding.price)}`,
      `<b>Size:</b> ${cleanForTelegram(finding.size_sqm)}`,
      `<b>GBP/sqm:</b> ${cleanForTelegram(finding.pounds_per_sqm)}`,
      `<b>Service charge:</b> ${cleanForTelegram(finding.service_charge)}`,
      `<b>Ground rent:</b> ${cleanForTelegram(finding.ground_rent)}`,
      `<b>Location:</b> ${cleanForTelegram(finding.location)}`,
      `<b>Strengths:</b> ${cleanForTelegram(finding.key_strengths)}`,
      `<b>Issues:</b> ${cleanForTelegram(finding.main_issues)}`,
      `<b>URL:</b> ${cleanForTelegram(finding.listing_url)}`,
    ].join("\n"))
    .join("\n\n--------------------\n\n");
}

function splitByEscapedLength(text: string, maxEscapedLength: number): string[] {
  if (maxEscapedLength <= 0) {
    throw new Error("Telegram message length limit is too small.");
  }

  const chunks: string[] = [];
  let current = "";

  for (const line of text.match(/[^\n]*\n?|$/g) ?? []) {
    if (!line) {
      continue;
    }

    if (escapeTelegramHtml(line).length > maxEscapedLength) {
      if (current) {
        chunks.push(current.trimEnd());
        current = "";
      }
      chunks.push(...splitLongLine(line, maxEscapedLength));
      continue;
    }

    if (escapeTelegramHtml(current + line).length > maxEscapedLength) {
      if (current) {
        chunks.push(current.trimEnd());
      }
      current = line;
    } else {
      current += line;
    }
  }

  if (current) {
    chunks.push(current.trimEnd());
  }

  return chunks.length > 0 ? chunks : [""];
}

function splitLongLine(line: string, maxEscapedLength: number): string[] {
  const parts: string[] = [];
  let part = "";

  for (const char of line) {
    const candidate = part + char;
    if (escapeTelegramHtml(candidate).length > maxEscapedLength) {
      if (part) {
        parts.push(part.trimEnd());
      }
      part = char;
    } else {
      part = candidate;
    }
  }

  if (part) {
    parts.push(part.trimEnd());
  }

  return parts;
}

function cleanForTelegram(value: string): string {
  return escapeTelegramHtml(value.replace(/\s+/g, " ").trim());
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
