from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env.local", extra="ignore")
    environment: str = "development"
    database_url: str = "postgresql+psycopg://yeoun:yeoun@127.0.0.1:54329/yeoun"
    web_origin: str = "http://localhost:3000"
    extra_origins: str = "http://127.0.0.1:3000"
    openai_api_key: str = ""
    model_quick: str = "gpt-6-sol"
    model_memory: str = "gpt-5.4-mini"
    model_story: str = "gpt-6-sol"
    model_fallback: str = "gpt-5.4-mini"
    demo_mode: bool = False
    run_worker: bool = True
    auto_create_schema: bool = False
    toss_secret_key: str = ""
    toss_client_key: str = ""
    revenuecat_webhook_secret: str = ""
    revenuecat_signing_secret: str = ""
    revenuecat_app_ids: str = ""
    session_days: int = 30

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value):
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @property
    def production(self):
        return self.environment == "production"

    def validate_runtime(self):
        if self.production:
            if self.demo_mode or self.auto_create_schema:
                raise RuntimeError(
                    "Production forbids demo mode and automatic schema creation"
                )
            if not self.database_url.startswith(
                "postgresql"
            ) or not self.web_origin.startswith("https://"):
                raise RuntimeError(
                    "Production requires PostgreSQL and an HTTPS web origin"
                )
            if not self.openai_api_key:
                raise RuntimeError("OPENAI_API_KEY is required in production")


@lru_cache
def settings():
    return Settings()
