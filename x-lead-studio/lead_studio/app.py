from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
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
from .marketing import create_link
from .media import download_image
from .rendering import render_four
from .scoring import is_eligible, score_lead
from .vision import analyze
from .xclient import READ_ONLY_OPERATIONS, read


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
    engagement_quality: int = Field(default=50, ge=0, le=100)
    account_quality: int = Field(default=50, ge=0, le=100)
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
        items, inserted = await _collect_search(payload.query, payload.product, payload.limit)
    except Exception as error:
        _raise_safe_x_error(error)
    return {"received": len(items), "inserted": len(inserted), "leadIds": inserted}


@app.post("/api/leads/import")
async def import_lead(payload: ImportRequest):
    author_hash = hashlib.sha256(payload.author.lower().encode()).hexdigest()
    lead_id = db.insert_lead({
        "post_id": payload.post_id,
        "author_hash": author_hash,
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
    result = await analyze(image_path, payload.mode, payload.model_dump(exclude={"mode"}), settings)
    score = score_lead(result, lead.get("posted_at"))
    status = "review" if is_eligible(result, score, settings.min_lead_score) else "rejected"
    copies = _drafts(result.get("pet_type", "pet"))
    db.update_lead(lead_id, {
        "pet_type": result.get("pet_type"), "pet_count": result.get("pet_count"),
        "clarity": result.get("clarity"), "print_fit": result.get("print_fit"),
        "pet_confidence": result.get("pet_confidence"), "engagement_quality": result.get("engagement_quality"),
        "recency_score": result.get("recency_score"), "account_quality": result.get("account_quality"),
        "sensitive": int(bool(result.get("sensitive"))), "person_primary": int(bool(result.get("person_primary"))),
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


def _candidate_from_tweet(tweet: dict[str, Any]) -> dict[str, Any] | None:
    media = tweet.get("media") or {}
    photos = media.get("photos") or []
    if not photos:
        return None
    photo = photos[0]
    media_url = photo.get("url") if isinstance(photo, dict) else None
    user = tweet.get("user") or tweet.get("author") or {}
    username = user.get("username") or user.get("login")
    post_id = str(tweet.get("id") or tweet.get("id_str") or "")
    if not media_url or not username or not post_id:
        return None
    return {
        "post_id": post_id,
        "author_hash": hashlib.sha256(username.lower().encode()).hexdigest(),
        "media_url": media_url,
        "post_url": f"https://x.com/{username}/status/{post_id}",
        "posted_at": str(tweet.get("date") or tweet.get("created_at") or "") or None,
    }


def _drafts(pet_type: str) -> dict[str, str]:
    return {
        "consent_copy": f"Your {pet_type} photo is wonderful. Would you be comfortable if I made a private product preview from it? No reposting or purchase required.",
        "public_copy": f"I made a small personalized pillow preview inspired by this lovely {pet_type}. If you want to see or edit it, here is the private design link: {{link}}",
        "dm_copy": f"Hi! I loved your {pet_type} photo and made a private personalized pillow preview. You can view or replace the image here: {{link}}. No pressure at all—reply stop and I will not contact you again.",
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
            try:
                await _collect_search(settings.default_query, "Latest", 50)
            except Exception:
                # The next scheduled run remains paused for a full day; no bypass or rapid retry.
                pass
        await asyncio.sleep(24 * 60 * 60)


async def _collect_search(query: str, product: str, limit: int) -> tuple[list[dict[str, Any]], list[int]]:
    if "since:" not in query:
        since = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        query = f"{query} since:{since} -filter:retweets min_faves:10"
    items = await read("search", {"q": query, "kv": {"product": product}}, limit, CREDENTIAL_PATH)
    inserted: list[int] = []
    for item in items:
        candidate = _candidate_from_tweet(item)
        if not candidate:
            continue
        lead_id = db.insert_lead(candidate)
        if lead_id:
            inserted.append(lead_id)
    return items, inserted
