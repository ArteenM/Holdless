"""Environment-driven settings. Every external service is optional: when its
credentials are missing the service falls back to a local stand-in, so the
golden path keeps working on venue Wi-Fi with nothing configured."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent
SEED_DIR = DATA_DIR / "seed"
SQL_DIR = DATA_DIR / "sql"

CLAUDE_MODEL = "claude-opus-5-5"


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _llm_enabled() -> bool:
    mode = _env("HOLDLESS_LLM", "auto").lower()
    if mode in ("on", "true", "1"):
        return True
    if mode in ("off", "false", "0"):
        return False
    return bool(
        _env("ANTHROPIC_API_KEY")
        or _env("ANTHROPIC_AUTH_TOKEN")
        or (Path.home() / ".config" / "anthropic").exists()
    )


@dataclass(frozen=True)
class Settings:
    llm_enabled: bool = field(default_factory=_llm_enabled)
    tiger_url: str = field(default_factory=lambda: _env("TIGER_DATABASE_URL"))
    snowflake_account: str = field(default_factory=lambda: _env("SNOWFLAKE_ACCOUNT"))
    snowflake_user: str = field(default_factory=lambda: _env("SNOWFLAKE_USER"))
    snowflake_password: str = field(default_factory=lambda: _env("SNOWFLAKE_PASSWORD"))
    snowflake_warehouse: str = field(default_factory=lambda: _env("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"))
    snowflake_database: str = field(default_factory=lambda: _env("SNOWFLAKE_DATABASE", "HOLDLESS"))
    snowflake_schema: str = field(default_factory=lambda: _env("SNOWFLAKE_SCHEMA", "INTEL"))
    snowflake_role: str = field(default_factory=lambda: _env("SNOWFLAKE_ROLE"))
    tz: str = field(default_factory=lambda: _env("HOLDLESS_TZ", "America/Vancouver"))


def get_settings() -> Settings:
    return Settings()
