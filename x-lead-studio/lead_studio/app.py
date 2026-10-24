from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, Field

from .config import CREDENTIAL_PATH, DB_PATH, MEDIA_DIR, MOCKUP_DIR, Settings, ensure_data_dirs
from .credentials import save_cookie
from .db import Database
from .discovery import collect_search
from .marketing import create_link
from .media import download_image
from .rendering import render_four
from .scoring import is_eligible, score_lead
from .targeting import SEARCH_SEGMENTS
from .vision import analyze
from .xclient import READ_ONLY_OPERATIONS, read
from .x_lead_worker import run_x_lead_worker
from .preview_download_worker import run_preview_download_worker
from .x_reply_worker import run_x_reply_worker


ensure_data_dirs()
settings = Settings()
db = Database(DB_PATH)
templates = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(("html", "xml")),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [asyncio.create_task(_retention_loop())]
    if settings.auto_collection_enabled:
        tasks.append(asyncio.create_task(_auto_collection_loop()))
    if settings.x_lead_worker_enabled:
        tasks.append(asyncio.create_task(run_x_lead_worker(settings)))
    if settings.preview_download_worker_enabled:
        tasks.append(asyncio.create_task(run_preview_download_worker(settings)))
    if settings.x_reply_worker_enabled:
        tasks.append(asyncio.create_task(run_x_reply_worker(settings)))
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="X Lead Studio", docs_url="/docs", redoc_url=None, lifespan=lifespan)
app.mount("/files", StaticFiles(directory=MEDIA_DIR.parent), name="files")


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    segment: str = Field(default="custom", pattern="^(custom|new_adoption|pet_birthday)$")
    product: str = Field(default="Latest", pattern="^(Latest|Top|Media)$")
    limit: int = Field(default=30, ge=1, le=50)


class ImportRequest(BaseModel):
    post_id: str = Field(min_length=1, max_length=64)
    author: str = Field(min_length=1, max_length=64)
    media_url: str
    post_url: str | None = None
    posted_at: str | None = None


class AnalysisRequest(BaseModel):
    mode: str = Field(pattern="^(manual|vision)$")
    has_pet: bool = True
    pet_type: str = "pet"
    pet_count: int = Field(default=1, ge=0, le=20)
    pet_confidence: int = Field(default=90, ge=0, le=100)
    clarity: int = Field(default=80, ge=0, le=100)
    print_fit: int = Field(default=80, ge=0, le=100)
    engagement_quality: int | None = Field(default=None, ge=0, le=100)
    account_quality: int | None = Field(default=None, ge=0, le=100)
    occasion: str | None = Field(default=None, max_length=50)
    occasion_confidence: int | None = Field(default=None, ge=0, le=100)
    ownership_confidence: int | None = Field(default=None, ge=0, le=100)
    us_confidence: int | None = Field(default=None, ge=0, le=100)
    us_evidence: str | None = Field(default=None, max_length=200)
    sensitive: bool = False
    advertisement: bool = False
    person_primary: bool = False
    minor_primary: bool = False


class LinkRequest(BaseModel):
    campaign: str = Field(min_length=1, max_length=100)
    channel: str = Field(pattern="^(consent_reply|public_reply|direct_message)$")
    variant: str = Field(min_length=1, max_length=100)


class ContactRequest(LinkRequest):
    final_copy: str = Field(min_length=1, max_length=1000)
    mockup_path: str | None = None


class AdvancedRequest(BaseModel):
    operation: str
    arguments: dict[str, Any] = {}
    limit: int = Field(default=20, ge=1, le=100)


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, status: str | None = None):
    return templates.get_template("index.html").render(
        request=request,
        leads=db.list_leads(status),
        default_query=settings.default_query,
        search_segments=SEARCH_SEGMENTS,
        cookie_configured=CREDENTIAL_PATH.exists(),
        operations=sorted(READ_ONLY_OPERATIONS),
    )


@app.post("/settings/cookie")
async def store_cookie(cookie: str = Form(min_length=10)):
    save_cookie(CREDENTIAL_PATH, cookie.strip())
    return RedirectResponse("/", status_code=303)


@app.post("/api/search")
async def search(payload: SearchRequest):
    try:
        items, inserted = await _collect_search(payload.query, payload.product, payload.limit, payload.segment)
    except Exception as error:
        _raise_safe_x_error(error)
    status_counts: dict[str, int] = {}
    for lead_id in inserted:
        lead = db.get_lead(lead_id)
        status = str(lead.get("status") if lead else "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "segment": payload.segment,
        "received": len(items),
        "inserted": len(inserted),
        "statusCounts": status_counts,
        "leadIds": inserted,
    }


@app.post("/api/leads/import")
async def import_lead(payload: ImportRequest):
    author_hash = hashlib.sha256(payload.author.lower().encode()).hexdigest()
    lead_id = db.insert_lead({
        "post_id": payload.post_id,
        "author_hash": author_hash,
        "author_handle": payload.author,
        "media_url": payload.media_url,
        "post_url": payload.post_url,
        "posted_at": payload.posted_at,
    })
    if not lead_id:
        return {"inserted": False, "reason": "duplicate_or_suppressed"}
    return {"inserted": True, "leadId": lead_id}


@app.post("/api/leads/{lead_id}/analyze")
async def analyze_lead(lead_id: int, payload: AnalysisRequest):
    lead = _lead_or_404(lead_id)
    image_path = await _ensure_local_image(lead)
    submitted = payload.model_dump(exclude={"mode"}, exclude_none=True)
    manual = submitted if payload.mode == "manual" else {}
    result = await analyze(image_path, payload.mode, manual, settings)
    visual_advertisement = bool(result.get("advertisement"))
    targeting = {
        "occasion": lead.get("occasion") or "unknown",
        "occasion_confidence": lead.get("occasion_confidence") or 0,
        "ownership_confidence": lead.get("ownership_confidence") or 0,
        "us_confidence": lead.get("us_confidence") or 0,
        "us_evidence": lead.get("us_evidence") or "no_public_location",
        "engagement_quality": lead.get("engagement_quality") if lead.get("engagement_quality") is not None else 20,
        "account_quality": lead.get("account_quality") if lead.get("account_quality") is not None else 35,
        "recency_score": lead.get("recency_score") if lead.get("recency_score") is not None else 40,
    }
    target_keys = {"occasion", "occasion_confidence", "ownership_confidence", "us_confidence", "us_evidence"}
    target_overrides = {key: value for key, value in submitted.items() if key in target_keys}
    result = {**result, **targeting, **manual, **target_overrides}
    result["advertisement"] = bool(lead.get("advertisement")) or visual_advertisement or bool(manual.get("advertisement"))
    score = score_lead(result, lead.get("posted_at"))
    status = "review" if is_eligible(
        result,
        score,
        settings.min_lead_score,
        settings.us_required,
        settings.us_min_confidence,
    ) else "rejected"
    copies = _drafts(
        result.get("pet_type", "pet"),
        result.get("occasion", "unknown"),
        result.get("occasion_confidence") or 0,
    )
    db.update_lead(lead_id, {
        "occasion": result.get("occasion"), "occasion_confidence": result.get("occasion_confidence"),
        "ownership_confidence": result.get("ownership_confidence"), "us_confidence": result.get("us_confidence"),
        "us_evidence": result.get("us_evidence"),
        "pet_type": result.get("pet_type"), "pet_count": result.get("pet_count"),
        "clarity": result.get("clarity"), "print_fit": result.get("print_fit"),
        "pet_confidence": result.get("pet_confidence"), "engagement_quality": result.get("engagement_quality"),
        "recency_score": result.get("recency_score"), "account_quality": result.get("account_quality"),
        "sensitive": int(bool(result.get("sensitive"))),
        "advertisement_visual": int(bool(result.get("advertisement"))),
        "person_primary": int(bool(result.get("person_primary"))),
        "minor_primary": int(bool(result.get("minor_primary"))), "score": score, "status": status,
        "analysis_json": json.dumps(result, ensure_ascii=False), **copies,
    })
    return {"analysis": result, "score": score, "status": status, **copies}


@app.post("/api/leads/{lead_id}/render")
async def render_lead(lead_id: int):
    lead = _lead_or_404(lead_id)
    if lead.get("status") not in {"review", "approved"}:
        raise HTTPException(409, "Only qualified leads can be rendered.")
    image_path = await _ensure_local_image(lead)
    paths = await asyncio.to_thread(render_four, image_path, MOCKUP_DIR / str(lead_id))
    db.update_lead(lead_id, {"mockup_json": json.dumps(paths)})
    return {"mockups": [_local_url(Path(path)) for path in paths]}


@app.post("/api/leads/{lead_id}/marketing-link")
async def marketing_link(lead_id: int, payload: LinkRequest):
    lead = _lead_or_404(lead_id)
    if lead.get("status") not in {"review", "approved", "contacted"}:
        raise HTTPException(409, "Lead must pass review before creating a link.")
    source_hash = hmac.new(
        settings.marketing_secret.encode(), f"x-post:{lead['post_id']}".encode(), hashlib.sha256
    ).hexdigest()
    idempotency_material = f"{lead['post_id']}\n{payload.campaign}\n{payload.channel}\n{payload.variant}"
    idempotency_key = "x-link:" + hashlib.sha256(idempotency_material.encode()).hexdigest()
    result = await create_link({
        "campaign": payload.campaign, "channel": payload.channel,
        "variant": payload.variant, "sourceHash": source_hash,
        "sourceImageUrl": lead["media_url"],
        "xLead": _marketing_lead_payload(lead, lead_id),
    }, idempotency_key, settings)
    db.update_lead(lead_id, {
        "marketing_url": result["url"], "campaign": payload.campaign,
        "channel": payload.channel, "variant": payload.variant,
    })
    return result


@app.post("/api/leads/{lead_id}/suppress")
async def suppress_lead(lead_id: int, reason: str = "rejected"):
    db.suppress(lead_id, reason)
    return {"suppressed": True}


@app.post("/api/leads/{lead_id}/contacted")
async def contacted(lead_id: int, payload: ContactRequest):
    _lead_or_404(lead_id)
    sent_at = datetime.now(timezone.utc).isoformat()
    db.update_lead(lead_id, {"status": "contacted", "contacted_at": sent_at})
    with db.connect() as connection:
        connection.execute(
            "insert into outreach(lead_id,channel,variant,final_copy,mockup_path,sent_at) values(?,?,?,?,?,?)",
            (lead_id, payload.channel, payload.variant, payload.final_copy, payload.mockup_path, sent_at),
        )
    return {"recorded": True, "note": "Sending remains manual on X."}


@app.post("/api/x/read")
async def advanced_read(payload: AdvancedRequest):
    try:
        return {"items": await read(payload.operation, payload.arguments, payload.limit, CREDENTIAL_PATH)}
    except Exception as error:
        _raise_safe_x_error(error)


@app.post("/api/cleanup")
async def cleanup():
    return {"deleted": await _cleanup_files()}


async def _ensure_local_image(lead: dict[str, Any]) -> Path:
    if lead.get("local_image_path") and Path(lead["local_image_path"]).exists():
        return Path(lead["local_image_path"])
    path, digest = await download_image(lead["media_url"], MEDIA_DIR)
    duplicate = next((item for item in db.list_leads() if item["id"] != lead["id"] and item.get("media_sha256") == digest), None)
    if duplicate:
        raise HTTPException(409, "This image already belongs to another lead.")
    db.update_lead(lead["id"], {"local_image_path": str(path), "media_sha256": digest})
    return path


def _marketing_lead_payload(lead: dict[str, Any], lead_id: int) -> dict[str, Any]:
    handle = str(lead.get("author_handle") or "").strip().lstrip("@")
    if not handle and lead.get("post_url"):
        parts = str(lead["post_url"]).split("/")
        if len(parts) > 3:
            handle = parts[3]
    return {
        "leadId": str(lead_id),
        "authorHash": lead["author_hash"],
        "handle": handle,
        "postId": str(lead["post_id"]),
        "postUrl": lead["post_url"],
        **({"segment": str(lead["segment"])} if lead.get("segment") else {}),
        **({"score": int(lead["score"])} if lead.get("score") is not None else {}),
    }


def _drafts(pet_type: str, occasion: str, occasion_confidence: int = 0) -> dict[str, str]:
    confirmed_occasion = occasion if occasion_confidence >= 70 else "unknown"
    opening = {
        "new_adoption": f"Congratulations on welcoming your new {pet_type} home.",
        "pet_birthday": f"Happy birthday to your {pet_type}!",
    }.get(confirmed_occasion, f"Your {pet_type} is absolutely adorable—this photo really made me smile!")
    return {
        "consent_copy": f"{opening} Would you be comfortable if I made a private pillow preview from the photo? No reposting or purchase required.",
        "public_copy": f"{opening} I made a small personalized pillow preview from the photo. If you want to see or edit it, here is the private design link: {{link}}",
        "dm_copy": f"Hi! {opening} I made a private personalized pillow preview. You can view or replace the image here: {{link}}. No pressure at all—reply stop and I will not contact you again.",
    }


def _lead_or_404(lead_id: int) -> dict[str, Any]:
    lead = db.get_lead(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found.")
    return lead


def _local_url(path: Path) -> str:
    return "/files/" + path.relative_to(MEDIA_DIR.parent).as_posix()


def _raise_safe_x_error(error: Exception):
    if isinstance(error, ValueError):
        raise HTTPException(400, str(error))
    message = str(error)
    stop_terms = ("captcha", "cloudflare", "unauthorized", "forbidden", "rate limit", "no account")
    if any(term in message.lower() for term in stop_terms):
        raise HTTPException(423, "X access paused. Re-import a valid cookie or wait for the rate limit; no bypass will be attempted.")
    raise HTTPException(502, f"Read-only X request failed: {type(error).__name__}")


async def _cleanup_files() -> int:
    deleted = 0
    for raw_path in db.cleanup_paths(7):
        path = Path(raw_path)
        if path.exists() and path.is_file() and MEDIA_DIR.parent in path.parents:
            path.unlink()
            deleted += 1
    return deleted


async def _retention_loop() -> None:
    while True:
        await _cleanup_files()
        await asyncio.sleep(3600)


async def _auto_collection_loop() -> None:
    await asyncio.sleep(60)
    while True:
        if CREDENTIAL_PATH.exists():
            per_segment = max(2, settings.auto_collection_daily_limit // len(SEARCH_SEGMENTS))
            for segment in SEARCH_SEGMENTS:
                geo_limit = max(1, per_segment // 2)
                broad_limit = max(1, per_segment - geo_limit)
                searches = (
                    (f"{segment.query} place_country:US", geo_limit),
                    (segment.query, broad_limit),
                )
                for query, limit in searches:
                    try:
                        await _collect_search(query, "Latest", limit, segment.key)
                    except Exception:
                        # Each planned search waits until the next daily run after an access failure.
                        continue
        await asyncio.sleep(24 * 60 * 60)


async def _collect_search(
    query: str,
    product: str,
    limit: int,
    source_segment: str = "custom",
) -> tuple[list[dict[str, Any]], list[int]]:
    items, candidates = await collect_search(
        query,
        product,
        limit,
        source_segment,
        cookie_path=CREDENTIAL_PATH,
        lookback_days=30,
        us_required=settings.us_required,
        us_min_confidence=settings.us_min_confidence,
    )
    inserted: list[int] = []
    for candidate in candidates:
        lead_id = db.insert_lead(candidate)
        if lead_id:
            inserted.append(lead_id)
    return items, inserted
