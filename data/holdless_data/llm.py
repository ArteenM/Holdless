"""Thin Claude wrapper: one structured-output call per task.

Callers must handle LLMUnavailable and fall back to the deterministic path —
the demo has to survive a dead API key or venue Wi-Fi."""

from __future__ import annotations

import base64
import logging
from functools import lru_cache
from typing import TypeVar

import anthropic
from pydantic import BaseModel

from .config import CLAUDE_MODEL, get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Server-side fallback: if a safety classifier declines, the API retries on
# Anthropic's recommended model inside the same call.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(timeout=60.0, max_retries=1)


def parse(
    *,
    system: str,
    content: list[dict],
    output: type[T],
    effort: str = "medium",
    max_tokens: int = 16000,
) -> T:
    if not get_settings().llm_enabled:
        raise LLMUnavailable("LLM disabled (HOLDLESS_LLM=off or no Anthropic credentials)")
    try:
        response = _client().beta.messages.parse(
            model=CLAUDE_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=output,
            output_config={"effort": effort},
            betas=[_FALLBACK_BETA],
            fallbacks="default",
        )
    except anthropic.APIConnectionError as e:
        raise LLMUnavailable(f"network error: {e}") from e
    except anthropic.RateLimitError as e:
        raise LLMUnavailable("rate limited") from e
    except anthropic.APIStatusError as e:
        raise LLMUnavailable(f"API error {e.status_code}: {e.message}") from e

    if response.stop_reason == "refusal":
        raise LLMUnavailable("request declined")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise LLMUnavailable(f"no parsed output (stop_reason={response.stop_reason})")
    log.info("claude %s ok (request %s)", output.__name__, response._request_id)
    return response.parsed_output


def image_block(data: bytes, media_type: str) -> dict:
    if media_type == "application/pdf":
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()},
        }
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()},
    }
