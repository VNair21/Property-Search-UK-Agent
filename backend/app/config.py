from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    app_name: str = "Starter API"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = [
        "http://localhost:19006",
        "http://127.0.0.1:19006",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ]
    openai_api_key: SecretStr | None = None
    default_openai_model: str = "gpt-5"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_use_tls: bool = True
    smtp_auth_method: Literal["none", "basic", "xoauth2"] = "basic"
    smtp_username: str = ""
    smtp_password: SecretStr | None = None
    smtp_oauth2_user: str = ""
    smtp_oauth2_access_token: SecretStr | None = None
    smtp_from_email: str = ""
    smtp_result_recipient: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR / ".env.local"),
        extra="ignore",
    )


settings = Settings()
