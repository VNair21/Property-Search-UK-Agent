import { createClient } from "redis";

import { getRedisConnectionConfig } from "./config";

type RedisArgument = string | number;
type RedisCommand = [string, ...RedisArgument[]];
type RedisResponse<T> = { result: T } | { error: string };

export type RedisDataClient = {
  ping(): Promise<string>;
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<void>;
  setStringWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void>;
  setJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<number>;
  setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  addToSet(key: string, ...members: string[]): Promise<number>;
  removeFromSet(key: string, ...members: string[]): Promise<number>;
  getSetMembers(key: string): Promise<string[]>;
  pipeline(commands: RedisCommand[]): Promise<unknown[]>;
};

type NodeRedisClient = {
  connect(): Promise<unknown>;
  on(event: "error", listener: (error: unknown) => void): NodeRedisClient;
  sendCommand<T = unknown>(args: ReadonlyArray<string>): Promise<T>;
};

let sharedRedisUrlClient: Promise<NodeRedisClient> | null = null;

export class RedisUrlClient implements RedisDataClient {
  private readonly redisUrl: string;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
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

  async setStringWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.command<string>(["SET", key, value, "EX", ttlSeconds]);
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

  async setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const command: RedisCommand = ttlSeconds
      ? ["SET", key, value, "EX", ttlSeconds, "NX"]
      : ["SET", key, value, "NX"];
    const result = await this.command<string | null>(command);
    return result === "OK";
  }

  async addToSet(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return 0;
    }

    return this.command<number>(["SADD", key, ...members]);
  }

  async removeFromSet(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return 0;
    }

    return this.command<number>(["SREM", key, ...members]);
  }

  async getSetMembers(key: string): Promise<string[]> {
    return this.command<string[]>(["SMEMBERS", key]);
  }

  async pipeline(commands: RedisCommand[]): Promise<unknown[]> {
    return Promise.all(commands.map((command) => this.command(command)));
  }

  private async command<T>(command: RedisCommand): Promise<T> {
    const client = await this.getClient();
    return client.sendCommand(command.map(String)) as Promise<T>;
  }

  private getClient(): Promise<NodeRedisClient> {
    if (!sharedRedisUrlClient) {
      const client = createClient({
        url: this.redisUrl,
        socket: {
          connectTimeout: 10000,
        },
      }) as unknown as NodeRedisClient;
      client.on("error", () => undefined);
      sharedRedisUrlClient = client.connect().then(() => client);
    }

    return sharedRedisUrlClient;
  }
}

export class RedisRestClient implements RedisDataClient {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
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

  async setStringWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.command<string>(["SET", key, value, "EX", ttlSeconds]);
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

  async setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    const command: RedisCommand = ttlSeconds
      ? ["SET", key, value, "EX", ttlSeconds, "NX"]
      : ["SET", key, value, "NX"];
    const result = await this.command<string | null>(command);
    return result === "OK";
  }

  async addToSet(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return 0;
    }

    return this.command<number>(["SADD", key, ...members]);
  }

  async removeFromSet(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) {
      return 0;
    }

    return this.command<number>(["SREM", key, ...members]);
  }

  async getSetMembers(key: string): Promise<string[]> {
    return this.command<string[]>(["SMEMBERS", key]);
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

export function createRedisClient(): RedisDataClient {
  const config = getRedisConnectionConfig();

  if (config.provider === "redis-url") {
    return new RedisUrlClient(config.url);
  }

  return new RedisRestClient(config.url, config.token);
}
