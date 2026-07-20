from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings

YOUTUBE_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/|live/))([A-Za-z0-9_-]{6,})"
)


@dataclass
class YoutubeVideo:
    video_id: str
    url: str
    title: str
    channel: str
    description: str
    view_count: int
    transcript: str


def extract_video_id(url_or_id: str) -> str | None:
    raw = (url_or_id or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", raw):
        return raw
    m = YOUTUBE_ID_RE.search(raw)
    if m:
        return m.group(1)
    parsed = urlparse(raw)
    if "youtube.com" in (parsed.netloc or ""):
        qs = parse_qs(parsed.query or "")
        vids = qs.get("v") or []
        if vids:
            return vids[0]
    return None


def _require_key() -> str:
    key = (settings.youtube_api_key or "").strip()
    if not key:
        raise ValueError("YOUTUBE_API_KEY не задан на сервере")
    return key


def fetch_transcript(video_id: str) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    except Exception:
        return ""
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id, languages=["en", "ru", "en-US", "en-GB"])
        texts: list[str] = []
        snippets = getattr(fetched, "snippets", None) or fetched
        for c in snippets:
            if isinstance(c, dict):
                texts.append(str(c.get("text") or ""))
            else:
                texts.append(str(getattr(c, "text", "") or ""))
        return " ".join(t for t in texts if t).strip()
    except Exception:
        return ""


def fetch_video(video_id: str) -> YoutubeVideo:
    key = _require_key()
    url = "https://www.googleapis.com/youtube/v3/videos"
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            url,
            params={
                "part": "snippet,statistics",
                "id": video_id,
                "key": key,
            },
        )
        res.raise_for_status()
        items = res.json().get("items") or []
        if not items:
            raise LookupError("Видео не найдено")
        item = items[0]
        sn = item.get("snippet") or {}
        st = item.get("statistics") or {}
        views = int(st.get("viewCount") or 0)
        transcript = fetch_transcript(video_id)
        return YoutubeVideo(
            video_id=video_id,
            url=f"https://www.youtube.com/watch?v={video_id}",
            title=str(sn.get("title") or "YouTube video"),
            channel=str(sn.get("channelTitle") or ""),
            description=str(sn.get("description") or ""),
            view_count=views,
            transcript=transcript,
        )


def search_videos(query: str, *, max_results: int = 5) -> list[str]:
    key = _require_key()
    q = (query or "").strip()
    if not q:
        return []
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "q": q,
                "type": "video",
                "maxResults": max(1, min(max_results, 10)),
                "order": "relevance",
                "key": key,
            },
        )
        res.raise_for_status()
        items = res.json().get("items") or []
        out: list[str] = []
        for it in items:
            vid = ((it.get("id") or {}).get("videoId") or "").strip()
            if vid:
                out.append(vid)
        return out
