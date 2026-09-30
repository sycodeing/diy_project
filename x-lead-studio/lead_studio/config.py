from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
DATA_DIR = ROOT / ".data"
MEDIA_DIR = DATA_DIR / "media"
MOCKUP_DIR = DATA_DIR / "mockups"
DB_PATH = DATA_DIR / "leads.sqlite3"
CREDENTIAL_PATH = DATA_DIR / "x-cookie.dpapi"


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


def ensure_data_dirs() -> None:
    for path in (DATA_DIR, MEDIA_DIR, MOCKUP_DIR):
        path.mkdir(parents=True, exist_ok=True)
