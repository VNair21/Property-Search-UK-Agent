from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load order (first found wins per variable):
# 1) OS environment variables
# 2) backend/.env.local (repo root execution)
# 3) backend/.env (repo root execution)
# 4) .env.local (backend directory execution)
# 5) .env (backend directory execution)
#
# This keeps secrets out of git while still making local development easy.
ENV_FILE_CANDIDATES = (
    "backend/.env.local",
    "backend/.env",
    ".env.local",
    ".env",
)


class Settings(BaseSettings):
    app_name: str = "Starter API"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = [
        "http://localhost:19006",
        "http://127.0.0.1:19006",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ]
    openai_api_key: str = ""
    default_openai_model: str = "gpt-5"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_use_tls: bool = True
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_result_recipient: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    model_config = SettingsConfigDict(
        env_file=ENV_FILE_CANDIDATES,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
