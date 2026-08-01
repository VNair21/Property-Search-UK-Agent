export class AppError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 500);
    this.name = "ConfigError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Sign in to use your property agent.") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
