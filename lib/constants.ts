export const AGENT_CONFIG_KEY = "property_agent:config";
export const AGENT_RESULTS_KEY = "property_agent:last_results";
export const AGENT_STATE_KEY = "property_agent:state";
export const AGENT_LOCK_KEY = "property_agent:run_lock";
export const AGENT_USER_IDS_KEY = "property_agent:users";
export const RUNNING_AGENT_USER_IDS_KEY = "property_agent:running_users";
export const AGENT_LOCK_TTL_SECONDS = 900;

export function agentKeysForUser(userId: string): {
  config: string;
  results: string;
  state: string;
  lock: string;
  credentials: string;
} {
  const prefix = `property_agent:user:${userId}`;

  return {
    config: `${prefix}:config`,
    results: `${prefix}:last_results`,
    state: `${prefix}:state`,
    lock: `${prefix}:run_lock`,
    credentials: `${prefix}:credentials`,
  };
}
