from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
# This worker is launched from long-lived desktop shells that may still carry
# stale project variables. The checked local .env is the operator-controlled
# source of truth for worker credentials and provider settings.
load_dotenv(ROOT / ".env", override=True)
DATA_DIR = ROOT / ".data"
MEDIA_DIR = DATA_DIR / "media"
MOCKUP_DIR = DATA_DIR / "mockups"
APIFY_CACHE_DIR = DATA_DIR / "apify" / "runs"
TWITTERAPI_STATE_PATH = DATA_DIR / "twitterapi" / "watermarks.json"
TWITTERAPI_ARCHIVE_DIR = DATA_DIR / "twitterapi" / "runs"
TWITTERAPI_ABOUT_CACHE_PATH = DATA_DIR / "twitterapi" / "user-about-cache.json"
DB_PATH = DATA_DIR / "leads.sqlite3"
CREDENTIAL_PATH = DATA_DIR / "x-cookie.dpapi"


def _default_x_use_home() -> Path:
    configured = os.getenv("X_USE_HOME", "").strip()
    if configured:
        return Path(configured)
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    return Path(local_app_data) / "x-use" if local_app_data else DATA_DIR / "x-use"


@dataclass(frozen=True)
class Settings:
    diy_site_url: str = os.getenv("DIY_SITE_URL", "http://localhost:3000").rstrip("/")
    marketing_secret: str = os.getenv("MARKETING_INGEST_SECRET", "")
    vision_mode: str = os.getenv("VISION_MODE", "manual")
    vision_base_url: str = os.getenv("VISION_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    vision_api_key: str = os.getenv("VISION_API_KEY", "")
    vision_model: str = os.getenv("VISION_MODEL", "gpt-4.1-mini")
    default_query: str = os.getenv(
        "DEFAULT_X_QUERY",
        "(puppy OR dog OR kitten OR cat) filter:images -filter:replies lang:en",
    )
    min_lead_score: int = int(os.getenv("MIN_LEAD_SCORE", "70"))
    auto_collection_enabled: bool = os.getenv("AUTO_COLLECTION_ENABLED", "true").lower() == "true"
    auto_collection_daily_limit: int = max(4, min(100, int(os.getenv("AUTO_COLLECTION_DAILY_LIMIT", "40"))))
    us_required: bool = os.getenv("US_REQUIRED", "true").lower() == "true"
    us_min_confidence: int = max(0, min(100, int(os.getenv("US_MIN_CONFIDENCE", "70"))))
    x_lead_worker_enabled: bool = os.getenv("X_LEAD_WORKER_ENABLED", "true").lower() == "true"
    x_lead_worker_secret: str = os.getenv("X_LEAD_WORKER_SECRET", "")
    x_lead_worker_poll_seconds: int = max(10, min(300, int(os.getenv("X_LEAD_WORKER_POLL_SECONDS", "30"))))
    preview_download_worker_enabled: bool = os.getenv("PREVIEW_DOWNLOAD_WORKER_ENABLED", "true").lower() == "true"
    preview_download_root: Path = Path(os.getenv("PREVIEW_DOWNLOAD_ROOT", r"D:\Temu\Photo\待发送"))
    preview_download_poll_seconds: int = max(5, min(300, int(os.getenv("PREVIEW_DOWNLOAD_POLL_SECONDS", "10"))))
    x_lead_provider: str = os.getenv("X_LEAD_PROVIDER", "twitterapi").strip().lower()
    twitterapi_api_key: str = os.getenv("TWITTERAPI_API_KEY", "").strip()
    twitterapi_base_url: str = os.getenv("TWITTERAPI_BASE_URL", "https://api.twitterapi.io").rstrip("/")
    twitterapi_us_query_share: int = max(50, min(100, int(os.getenv("TWITTERAPI_US_QUERY_SHARE", "90"))))
    twitterapi_geo_query_enabled: bool = os.getenv("TWITTERAPI_GEO_QUERY_ENABLED", "false").lower() == "true"
    twitterapi_about_enrichment_enabled: bool = os.getenv(
        "TWITTERAPI_ABOUT_ENRICHMENT_ENABLED", "true"
    ).lower() == "true"
    twitterapi_about_cache_days: int = max(1, min(90, int(os.getenv("TWITTERAPI_ABOUT_CACHE_DAYS", "30"))))
    apify_enabled: bool = os.getenv("APIFY_ENABLED", "false").lower() == "true"
    apify_api_token: str = os.getenv("APIFY_API_TOKEN", "").strip()
    apify_actor_id: str = os.getenv("APIFY_ACTOR_ID", "KvRrkwDDFm4vmklVv").strip()
    apify_max_charge_usd: float = max(0.01, min(10.0, float(os.getenv("APIFY_MAX_CHARGE_USD", "1.00"))))
    x_reply_worker_enabled: bool = os.getenv("X_REPLY_WORKER_ENABLED", "true").lower() == "true"
    x_reply_worker_secret: str = os.getenv("X_REPLY_WORKER_SECRET", "")
    x_reply_worker_poll_seconds: int = max(10, min(300, int(os.getenv("X_REPLY_WORKER_POLL_SECONDS", "15"))))
    bitbrowser_api_url: str = os.getenv("BITBROWSER_API_URL", "http://127.0.0.1:54345").rstrip("/")
    x_use_home: Path = field(default_factory=_default_x_use_home)


def ensure_data_dirs() -> None:
    for path in (DATA_DIR, MEDIA_DIR, MOCKUP_DIR, APIFY_CACHE_DIR, TWITTERAPI_ARCHIVE_DIR):
        path.mkdir(parents=True, exist_ok=True)
