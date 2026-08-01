import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

import { AGENT_USER_IDS_KEY } from "./constants";
import { AuthError, ValidationError } from "./errors";
import { createRedisClient, type RedisDataClient } from "./redis";
import type { AuthResponse, AuthUser } from "./types";

const hashPasswordAsync = promisify(pbkdf2);
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,46}[a-z0-9])$/;

type AuthMode = "login" | "create";

type StoredUser = AuthUser & {
  password_salt: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

type StoredSession = AuthUser & {
  created_at: string;
  expires_at: string;
};

export async function authenticateUser(input: unknown): Promise<AuthResponse> {
  if (!isRecord(input)) {
    throw new ValidationError("Request body must be a JSON object.");
  }

  const mode = authModeFromInput(input.mode);
  const username = normalizeUsername(input.username);
  const password = passwordFromInput(input.password);
  const redis = createRedisClient();

  if (mode === "create") {
    return createUser(redis, username, password);
  }

  return loginUser(redis, username, password);
}

export async function getAuthenticatedUser(request: Request): Promise<AuthUser> {
  const token = sessionTokenFromRequest(request);
  const redis = createRedisClient();
  const tokenHash = hashSessionToken(token);
  const session = await redis.getJson<StoredSession>(sessionKey(tokenHash));

  if (!session) {
    throw new AuthError();
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    await redis.delete(sessionKey(tokenHash));
    throw new AuthError("Your session expired. Sign in again.");
  }

  return {
    id: session.id,
    username: session.username,
  };
}

export async function logoutAuthenticatedUser(request: Request): Promise<{ status: "signed_out" }> {
  const token = sessionTokenFromRequest(request);
  const redis = createRedisClient();
  await redis.delete(sessionKey(hashSessionToken(token)));

  return { status: "signed_out" };
}

async function createUser(redis: RedisDataClient, username: string, password: string): Promise<AuthResponse> {
  const now = new Date().toISOString();
  const salt = randomBytes(16).toString("base64url");
  const user: StoredUser = {
    id: username,
    username,
    password_salt: salt,
    password_hash: await hashPassword(password, salt),
    created_at: now,
    updated_at: now,
  };

  const created = await redis.setIfAbsent(userProfileKey(username), JSON.stringify(user));
  if (!created) {
    throw new ValidationError("That username is already taken.");
  }

  await redis.addToSet(AGENT_USER_IDS_KEY, username);
  return createSession(redis, user);
}

async function loginUser(redis: RedisDataClient, username: string, password: string): Promise<AuthResponse> {
  const user = await redis.getJson<StoredUser>(userProfileKey(username));
  if (!user || !(await verifyPassword(password, user))) {
    throw new AuthError("Invalid username or password.");
  }

  return createSession(redis, user);
}

async function createSession(redis: RedisDataClient, user: AuthUser): Promise<AuthResponse> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const session: StoredSession = {
    id: user.id,
    username: user.username,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  };

  await redis.setStringWithExpiry(sessionKey(hashSessionToken(token)), JSON.stringify(session), SESSION_TTL_SECONDS);

  return {
    user: {
      id: user.id,
      username: user.username,
    },
    session_token: token,
    expires_at: expiresAt,
  };
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await hashPasswordAsync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  return key.toString("base64url");
}

async function verifyPassword(password: string, user: StoredUser): Promise<boolean> {
  const candidate = Buffer.from(await hashPassword(password, user.password_salt), "base64url");
  const expected = Buffer.from(user.password_hash, "base64url");

  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function authModeFromInput(value: unknown): AuthMode {
  if (value === "login" || value === "create") {
    return value;
  }

  throw new ValidationError("mode must be either login or create.");
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("username is required.");
  }

  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError("Use 3-48 characters: letters, numbers, dots, underscores, or hyphens.");
  }

  return username;
}

function passwordFromInput(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new ValidationError("Password must be at least 8 characters.");
  }

  return value;
}

function sessionTokenFromRequest(request: Request): string {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (!match?.[1]) {
    throw new AuthError();
  }

  return match[1].trim();
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function userProfileKey(userId: string): string {
  return `property_agent:user:${userId}:profile`;
}

function sessionKey(tokenHash: string): string {
  return `property_agent:session:${tokenHash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
