from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

SYSTEM_PROMPT = """You are a poker coach writing short hand breakdowns for a poker training site.
Given source material (YouTube transcript/description and/or raw hand history), respond with STRICT JSON only:
{
  "title": "short Russian title",
  "analysis_md": "markdown breakdown in Russian: streets, key decisions, mistakes, conclusion",
  "hand_raw_text": "PokerStars/GG-style hand history if you can reconstruct one, else empty string",
  "hero_hand": "4-char like AhKd or empty",
  "stakes_label": "e.g. NL50 or empty",
  "tags": ["tag1", "tag2"]
}
Rules:
- analysis_md must be in Russian, concrete, 2-6 short sections.
- If no reliable hand can be reconstructed, leave hand_raw_text empty but still write analysis from the video content.
- Do not invent exact card runouts unless present in the source.
- Output JSON only, no markdown fences.
"""


@dataclass
class LlmFeedResult:
    title: str
    analysis_md: str
    hand_raw_text: str
    hero_hand: str | None
    stakes_label: str | None
    tags: list[str]


def _require_key() -> str:
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise ValueError("OPENAI_API_KEY не задан на сервере")
    return key


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def analyze_source(
    *,
    model_name: str | None = None,
    source_title: str = "",
    source_channel: str = "",
    source_url: str = "",
    description: str = "",
    transcript: str = "",
    raw_hh: str = "",
) -> LlmFeedResult:
    key = _require_key()
    model = (model_name or settings.openai_model or "gpt-4o-mini").strip()
    base = (settings.openai_base_url or "https://api.openai.com/v1").rstrip("/")

    parts = [
        f"Source title: {source_title}",
        f"Channel: {source_channel}",
        f"URL: {source_url}",
    ]
    if raw_hh.strip():
        parts.append("RAW HAND HISTORY:\n" + raw_hh.strip()[:20000])
    if description.strip():
        parts.append("VIDEO DESCRIPTION:\n" + description.strip()[:8000])
    if transcript.strip():
        parts.append("TRANSCRIPT:\n" + transcript.strip()[:20000])
    user_content = "\n\n".join(parts)

    payload = {
        "model": model,
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=90.0) as client:
        res = client.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if res.status_code >= 400:
            detail = res.text[:400]
            raise ValueError(f"LLM error {res.status_code}: {detail}")
        data = res.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Некорректный ответ LLM") from exc

    parsed: dict[str, Any]
    try:
        parsed = json.loads(_strip_fences(content))
    except json.JSONDecodeError as exc:
        raise ValueError("LLM вернул не-JSON") from exc

    tags_raw = parsed.get("tags") or []
    tags = [str(t).strip()[:40] for t in tags_raw if str(t).strip()][:8]
    hero = str(parsed.get("hero_hand") or "").strip() or None
    if hero and len(hero) > 8:
        hero = hero[:8]
    hh = str(parsed.get("hand_raw_text") or "").strip()
    title = str(parsed.get("title") or source_title or "Разбор раздачи").strip()[:400]
    analysis = str(parsed.get("analysis_md") or "").strip()
    if not analysis:
        analysis = "Разбор не удалось сформировать."
    stakes = str(parsed.get("stakes_label") or "").strip() or None

    return LlmFeedResult(
        title=title or "Разбор раздачи",
        analysis_md=analysis,
        hand_raw_text=hh,
        hero_hand=hero,
        stakes_label=stakes[:64] if stakes else None,
        tags=tags,
    )
