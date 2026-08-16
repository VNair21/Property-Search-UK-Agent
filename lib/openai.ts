import { toMarkdownTable } from "./format";
import { validateFindings } from "./validation";
import type { PropertyAgentConfig, SearchRunResult } from "./types";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export async function runPropertySearch(config: PropertyAgentConfig): Promise<SearchRunResult> {
  if (!config.openai?.apiKey) {
    throw new Error("OpenAI API key must be configured in the dashboard.");
  }

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: buildPrompt(config),
      tools: [{ type: "web_search_preview" }],
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${extractErrorMessage(payload)}`);
  }

  const outputText = extractResponseText(payload);
  const rawJson = extractJsonPayload(outputText);
  const parsed = JSON.parse(rawJson) as unknown;
  const findings = validateFindings(parsed)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((finding, index) => ({ ...finding, rank: index + 1 }));

  return {
    findings,
    tableMarkdown: toMarkdownTable(findings),
  };
}

function buildPrompt(config: PropertyAgentConfig): string {
  const domains = config.websites_to_search.map((site) => `- ${site}`).join("\n");
  const areas = config.areas_to_search.map((area) => `- ${area}`).join("\n");

  return [
    "Search for residential properties to buy and return JSON only.",
    "Rules:",
    "1) Use only the websites listed below as sources.",
    "2) Search only within the areas listed below.",
    "3) Include only properties matching the criteria exactly.",
    "4) Perform a deep search across each site and inspect candidate listing details before including them.",
    "5) Return at most 10 results.",
    "6) For every included result, provide the exact live listing URL where it was found.",
    "7) Output must match this JSON schema:",
    '{"findings":[{"rank":1,"property":"...","price":"...","size_sqm":"...","pounds_per_sqm":"...","service_charge":"...","ground_rent":"...","location":"...","key_strengths":"...","main_issues":"...","listing_url":"https://..."}]}',
    "Websites to Search:",
    domains,
    "Areas to Search:",
    areas,
    "Property Criteria:",
    config.property_criteria,
    "If exact data for a field is unavailable, write 'Not listed'. Never use 'Not listed' for listing_url.",
  ].join("\n");
}

function extractJsonPayload(outputText: string): string {
  const cleaned = outputText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Model response did not contain valid JSON.");
  }

  return match[0];
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("OpenAI response did not include output text.");
  }

  const text = payload.output
    .flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        return [];
      }

      return item.content.flatMap((content) => {
        if (!isRecord(content)) {
          return [];
        }

        if (content.type === "output_text" && typeof content.text === "string") {
          return [content.text];
        }

        return [];
      });
    })
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return text;
}

function extractErrorMessage(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  return "Unknown OpenAI error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
