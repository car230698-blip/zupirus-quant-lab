#!/usr/bin/env python3
"""
YouTube New Video/Shorts -> Discord Public Channel Auto-Notifier (Zero API Key).

Polls the official YouTube Atom RSS feed for @ZupirusTradingAcademy every 15 minutes
via VPS crontab and posts a rich Embed (with thumbnail + watch link) to
DISCORD_WEBHOOK_SIGNALS whenever a new video or Short is published.

Usage:
  python3 scripts/discord_youtube_notifier.py            # Normal cron run (posts new videos only)
  python3 scripts/discord_youtube_notifier.py --check    # Resolve channel & list latest videos (no Discord post)
  python3 scripts/discord_youtube_notifier.py --post-latest  # Force-post the latest video once (for live test)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List

YOUTUBE_HANDLE_URL = "https://www.youtube.com/@ZupirusTradingAcademy"
STATE_FILE = Path("/tmp/zupirus_youtube_notifier_state.json")
ATOM_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def _load_env_var(key_name: str) -> str:
    val = os.environ.get(key_name, "").strip()
    if val:
        return val
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if env_file.is_file():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == key_name:
                return v.strip().strip('"').strip("'")
    return ""


def _load_state() -> Dict[str, object]:
    if STATE_FILE.is_file():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (ValueError, OSError):
            pass
    return {"channel_id": "", "seen_ids": []}


def _save_state(state: Dict[str, object]) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_channel_id(state: Dict[str, object]) -> str:
    env_cid = _load_env_var("YOUTUBE_CHANNEL_ID")
    if env_cid:
        return env_cid
    cached = str(state.get("channel_id") or "").strip()
    if cached.startswith("UC") and len(cached) == 24:
        return cached
    req = urllib.request.Request(
        YOUTUBE_HANDLE_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
            "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    for pattern in (
        r'channel_id=(UC[a-zA-Z0-9_-]{22})',
        r'"channelId":"(UC[a-zA-Z0-9_-]{22})"',
        r'"externalId":"(UC[a-zA-Z0-9_-]{22})"',
        r'https://www\.youtube\.com/channel/(UC[a-zA-Z0-9_-]{22})',
    ):
        m = re.search(pattern, html)
        if m:
            return m.group(1)
    raise RuntimeError(f"Could not resolve YouTube channel_id from {YOUTUBE_HANDLE_URL}")


def fetch_latest_videos(channel_id: str) -> List[Dict[str, str]]:
    rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(rss_url, headers={"User-Agent": "ZupirusYouTubeNotifier/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        xml_bytes = resp.read()
    root = ET.fromstring(xml_bytes)
    videos: List[Dict[str, str]] = []
    for entry in root.findall("atom:entry", ATOM_NS):
        vid_el = entry.find("yt:videoId", ATOM_NS)
        title_el = entry.find("atom:title", ATOM_NS)
        link_el = entry.find("atom:link", ATOM_NS)
        pub_el = entry.find("atom:published", ATOM_NS)
        if vid_el is None or not vid_el.text:
            continue
        vid = vid_el.text.strip()
        title = (title_el.text or "Video mới trên Zupirus Trading Academy").strip() if title_el is not None else ""
        link = link_el.attrib.get("href", f"https://www.youtube.com/watch?v={vid}") if link_el is not None else f"https://www.youtube.com/watch?v={vid}"
        published = (pub_el.text or "").strip() if pub_el is not None else ""
        videos.append(
            {
                "id": vid,
                "title": title,
                "url": link,
                "published": published,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            }
        )
    return videos


def post_video_to_discord(webhook_url: str, video: Dict[str, str]) -> int:
    is_short = "/shorts/" in video["url"]
    badge = "YOUTUBE SHORTS MỚI" if is_short else "VIDEO MỚI TRÊN YOUTUBE"
    payload = {
        "username": "ZUPIRUS Trading Academy",
        "content": f"🎬 **{badge}** từ **Zupirus Trading Academy**! Xem ngay: {video['url']}",
        "embeds": [
            {
                "title": video["title"],
                "url": video["url"],
                "description": (
                    "Video mới vừa lên sóng trên kênh **@ZupirusTradingAcademy**. "
                    "Bấm xem & thảo luận chiến lược XAU/USD / Prop Firm ngay cùng anh em trong server!"
                ),
                "color": 0xEF4444,
                "image": {"url": video["thumbnail"]},
                "fields": [
                    {"name": "Kênh YouTube", "value": "[@ZupirusTradingAcademy](https://www.youtube.com/@ZupirusTradingAcademy)", "inline": True},
                    {"name": "Công cụ miễn phí", "value": "[Tính Lot XAU/USD](https://zupirus.com/cong-cu/tinh-lot-size-xauusd)", "inline": True},
                ],
                "footer": {"text": "ZUPIRUS Trading Academy · Tự động đồng bộ YouTube -> Discord"},
            }
        ],
    }
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "ZupirusYouTubeNotifier/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return int(resp.status)


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll YouTube RSS and notify Discord on new videos.")
    parser.add_argument("--check", action="store_true", help="Only resolve channel_id and print latest videos.")
    parser.add_argument("--post-latest", action="store_true", help="Force-post the single latest video to Discord.")
    args = parser.parse_args()

    state = _load_state()
    channel_id = resolve_channel_id(state)
    state["channel_id"] = channel_id
    videos = fetch_latest_videos(channel_id)

    if args.check:
        print(f"YOUTUBE_CHECK_OK: channel_id={channel_id} entries={len(videos)}")
        for v in videos[:3]:
            print(f"  - {v['id']} | {v['published']} | {v['title']}")
        return 0

    webhook_url = _load_env_var("DISCORD_WEBHOOK_YOUTUBE") or _load_env_var("DISCORD_WEBHOOK_SIGNALS")
    if not webhook_url:
        print("YOUTUBE_NOTIFIER_SKIP: no Discord webhook configured", file=sys.stderr)
        return 1

    seen_ids = [str(x) for x in (state.get("seen_ids") or [])]

    if args.post_latest:
        if not videos:
            print("YOUTUBE_NO_VIDEOS_YET: channel has 0 published videos; state initialized.")
            _save_state(state)
            return 0
        latest = videos[0]
        status = post_video_to_discord(webhook_url, latest)
        if latest["id"] not in seen_ids:
            seen_ids.insert(0, latest["id"])
        # Mark older existing videos as seen so cron only posts future new uploads
        for v in videos:
            if v["id"] not in seen_ids:
                seen_ids.append(v["id"])
        state["seen_ids"] = seen_ids[:100]
        _save_state(state)
        print(f"YOUTUBE_POST_OK: http={status} video_id={latest['id']} title={latest['title']}")
        return 0

    # First-ever run: seed seen_ids without spamming old backlog
    if not seen_ids and videos:
        state["seen_ids"] = [v["id"] for v in videos[:100]]
        _save_state(state)
        print(f"YOUTUBE_SEED_OK: seeded {len(videos)} existing videos")
        return 0

    new_videos = [v for v in videos if v["id"] not in seen_ids]
    for v in reversed(new_videos[:3]):
        status = post_video_to_discord(webhook_url, v)
        seen_ids.insert(0, v["id"])
        print(f"YOUTUBE_NEW_VIDEO_POSTED: http={status} video_id={v['id']}")

    state["seen_ids"] = seen_ids[:100]
    _save_state(state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
