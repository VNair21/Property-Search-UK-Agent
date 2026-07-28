export const FREQUENCY_OPTIONS = ["Hourly", "Daily", "Weekly", "Monthly"] as const;

export type FrequencyOption = (typeof FREQUENCY_OPTIONS)[number];
export type NotificationChannel = "telegram" | "email";
export type AgentLifecycleStatus = "running" | "stopped";

export const frequencyToMinutes: Record<FrequencyOption, number> = {
  Hourly: 60,
  Daily: 24 * 60,
  Weekly: 7 * 24 * 60,
  Monthly: 30 * 24 * 60,
};

export type PropertyFinding = {
  rank: number;
  property: string;
  price: string;
  size_sqm: string;
  pounds_per_sqm: string;
  service_charge: string;
  ground_rent: string;
  location: string;
  key_strengths: string;
  main_issues: string;
  listing_url: string;
};

export type PropertyAgentConfig = {
  websites_to_search: string[];
  areas_to_search: string[];
  property_criteria: string;
  update_frequency_minutes: number;
  run_time_uk: string | null;
  model: string;
};

export type PropertyAgentSetRequest = {
  websites_to_search: string;
  areas_to_search: string;
  property_criteria: string;
  update_frequency_minutes: number;
  run_time_uk?: string | null;
  model?: string | null;
};

export type StoredSearchResults = {
  timestamp: string;
  findings: PropertyFinding[];
  table_markdown: string;
};

export type StoredAgentState = {
  status: AgentLifecycleStatus;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  updated_at: string;
  notification_channel: NotificationChannel | null;
  recipient: string | null;
};

export type PropertyAgentSetResponse = {
  status: AgentLifecycleStatus;
  model: string;
  update_frequency_minutes: number;
  run_time_uk: string | null;
  next_run_at: string | null;
  notification_channel: NotificationChannel;
  recipient: string;
  findings: PropertyFinding[];
  table_markdown: string;
};

export type PropertyAgentStatusResponse = {
  is_running: boolean;
  update_frequency_minutes: number | null;
  run_time_uk: string | null;
  model: string | null;
  last_results_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  notification_channel: NotificationChannel | null;
  recipient: string | null;
  config: PropertyAgentConfig | null;
  findings: PropertyFinding[];
};

export type SearchRunResult = {
  findings: PropertyFinding[];
  tableMarkdown: string;
};
