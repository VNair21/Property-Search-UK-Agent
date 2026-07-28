import { getRedisConfig } from "./config";

type RedisArgument = string | number;
type RedisCommand = [string, ...RedisArgument[]];
type RedisResponse<T> = { result: T } | { error: string };

export class RedisRestClient {
  private readonly url: string;
  private readonly token: string;

  constructor() {
    const config = getRedisConfig();
    this.url = config.url;
    this.token = config.token;
  }

  async ping(): Promise<string> {
    return this.command<string>(["PING"]);
  }

  async getString(key: string): Promise<string | null> {
    return this.command<string | null>(["GET", key]);
  }

  async setString(key: string, value: string): Promise<void> {
    await this.command<string>(["SET", key, value]);
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.setString(key, JSON.stringify(value));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.getString(key);
    if (raw === null) {
      return null;
    }

    return JSON.parse(raw) as T;
  }

  async delete(key: string): Promise<number> {
    return this.command<number>(["DEL", key]);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.command<string | null>(["SET", key, value, "EX", ttlSeconds, "NX"]);
    return result === "OK";
  }

  async pipeline(commands: RedisCommand[]): Promise<unknown[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(commands),
      cache: "no-store",
    });

    const payload = (await response.json()) as RedisResponse<unknown>[];
    if (!response.ok) {
      throw new Error(`Redis request failed with HTTP ${response.status}`);
    }

    return payload.map((item) => {
      if ("error" in item) {
        throw new Error(`Redis command failed: ${item.error}`);
      }

      return item.result;
    });
  }

  private async command<T>(command: RedisCommand): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(command),
      cache: "no-store",
    });

    const payload = (await response.json()) as RedisResponse<T>;
    if (!response.ok) {
      throw new Error(`Redis request failed with HTTP ${response.status}`);
    }

    if ("error" in payload) {
      throw new Error(`Redis command failed: ${payload.error}`);
    }

    return payload.result;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
}

export function createRedisClient(): RedisRestClient {
  return new RedisRestClient();
}
