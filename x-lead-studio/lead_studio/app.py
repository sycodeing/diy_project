from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import socket
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
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
from .targeting import SEARCH_SEGMENTS, build_targeting, candidate_status
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
    if settings.remote_queue_enabled:
        tasks.append(asyncio.create_task(_remote_queue_loop()))
    elif settings.auto_collection_enabled:
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
        items, inserted = await _collect_search(
            payload.query,
            payload.product,
            payload.limit,
            payload.segment,
        )
    except Exception as error:
        _raise_safe_x_error(error)
    return {"received": len(items), "inserted": len(inserted), "leadIds": inserted}


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


def _candidate_from_tweet(
    tweet: dict[str, Any],
    source_segment: str = "custom",
    us_required: bool | None = None,
    us_min_confidence: int | None = None,
) -> dict[str, Any] | None:
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
    targeting = build_targeting(tweet, source_segment)
    status = candidate_status(
        targeting,
        settings.us_required if us_required is None else us_required,
        settings.us_min_confidence if us_min_confidence is None else us_min_confidence,
    )
    return {
        "post_id": post_id,
        "author_hash": hashlib.sha256(username.lower().encode()).hexdigest(),
        "author_handle": username,
        "media_url": media_url,
        "post_url": f"https://x.com/{username}/status/{post_id}",
        "posted_at": str(tweet.get("date") or tweet.get("created_at") or "") or None,
        "status": status,
        "segment": targeting["segment"],
        "occasion": targeting["occasion"],
        "occasion_confidence": targeting["occasion_confidence"],
        "ownership_confidence": targeting["ownership_confidence"],
        "us_confidence": targeting["us_confidence"],
        "us_evidence": targeting["us_evidence"],
        "organization": int(targeting["organization"]),
        "advertisement": int(targeting["advertisement"]),
        "like_count": targeting["like_count"],
        "reply_count": targeting["reply_count"],
        "repost_count": targeting["repost_count"],
        "view_count": targeting["view_count"],
        "followers_count": targeting["followers_count"],
        "engagement_quality": targeting["engagement_quality"],
        "account_quality": targeting["account_quality"],
        "recency_score": targeting["recency_score"],
        "score": targeting["lead_score"],
        "targeting_json": json.dumps(targeting, ensure_ascii=False),
    }


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
        **({"score": int(lead["score"])} if lead.get("score") is not None else {}),
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


async def _collect_search(
    query: str,
    product: str,
    limit: int,
    source_segment: str = "custom",
    lookback_days: int = 30,
    us_required: bool | None = None,
    us_min_confidence: int | None = None,
) -> tuple[list[dict[str, Any]], list[int]]:
    if "since:" not in query:
        since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).date().isoformat()
        query = f"{query} since:{since}"
    if "-filter:retweets" not in query and "-is:retweet" not in query:
        query = f"{query} -filter:retweets"
    items = await read("search", {"q": query, "kv": {"product": product}}, limit, CREDENTIAL_PATH)
    inserted: list[int] = []
    for item in items:
        candidate = _candidate_from_tweet(
            item,
            source_segment,
            us_required,
            us_min_confidence,
        )
        if not candidate:
            continue
        lead_id = db.insert_lead(candidate)
        if lead_id:
            inserted.append(lead_id)
    return items, inserted


async def _remote_queue_loop() -> None:
    if len(settings.worker_secret) < 32:
        return
    worker_id = f"{socket.gethostname()}-x-lead-studio"[:120]
    await asyncio.sleep(5)
    while True:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{settings.diy_site_url}/api/x-leads/worker/jobs/claim",
                    headers={"Authorization": f"Bearer {settings.worker_secret}"},
                    json={
                        "workerId": worker_id,
                        "cookieConfigured": CREDENTIAL_PATH.exists(),
                        "version": "1.0.0",
                    },
                )
            if response.status_code == 204:
                await asyncio.sleep(settings.worker_poll_seconds)
                continue
            response.raise_for_status()
            job = response.json()["job"]
            await _execute_remote_job(worker_id, job)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Network failures are retried slowly. X access failures are reported per job below.
            await asyncio.sleep(max(60, settings.worker_poll_seconds))
        else:
            await asyncio.sleep(2)


async def _execute_remote_job(worker_id: str, job: dict[str, Any]) -> None:
    configuration = job.get("configuration") or {}
    segments = [
        segment for segment in SEARCH_SEGMENTS
        if segment.key in configuration.get("segments", [])
    ]
    if not segments:
        await _report_remote_job(worker_id, job["id"], "failed", 0, [], "invalid_config", "没有可执行的目标人群。")
        return

    product = str(configuration.get("searchProduct") or "Latest")
    if product not in {"Latest", "Top", "Media"}:
        product = "Latest"
    total_limit = max(1, min(100, int(configuration.get("resultLimit") or 40)))
    lookback_days = max(1, min(90, int(configuration.get("lookbackDays") or 30)))
    us_required = bool(configuration.get("usRequired", True))
    us_min_confidence = max(0, min(100, int(configuration.get("usMinConfidence") or 70)))
    query_count = len(segments) * (2 if us_required else 1)
    per_query = max(1, (total_limit + query_count - 1) // query_count)
    received_count = 0
    candidates: dict[str, dict[str, Any]] = {}

    try:
        for segment in segments:
            queries = [segment.query]
            if us_required:
                queries = [f"{segment.query} place_country:US", segment.query]
            for query in queries:
                items, _ = await _collect_search(
                    query,
                    product,
                    per_query,
                    segment.key,
                    lookback_days,
                    us_required,
                    us_min_confidence,
                )
                received_count += len(items)
                for item in items:
                    candidate = _candidate_from_tweet(
                        item,
                        segment.key,
                        us_required,
                        us_min_confidence,
                    )
                    if candidate and len(candidates) < total_limit:
                        candidates[candidate["post_id"]] = _remote_candidate_payload(candidate)
        await _report_remote_job(
            worker_id,
            job["id"],
            "completed",
            received_count,
            list(candidates.values()),
        )
    except Exception as error:
        message = str(error)
        blocked_terms = ("captcha", "cloudflare", "unauthorized", "forbidden", "rate limit", "no account")
        blocked = any(term in message.lower() for term in blocked_terms)
        await _report_remote_job(
            worker_id,
            job["id"],
            "blocked" if blocked else "failed",
            received_count,
            [],
            "x_access_blocked" if blocked else type(error).__name__,
            "X 访问已暂停，请检查 Cookie、验证要求或限流。" if blocked else message[:1000],
        )


def _remote_candidate_payload(candidate: dict[str, Any]) -> dict[str, Any]:
    copies = _drafts("pet")
    targeting = json.loads(candidate.get("targeting_json") or "{}")
    return {
        "postId": candidate["post_id"],
        "authorHash": candidate["author_hash"],
        "handle": candidate["author_handle"],
        "postUrl": candidate["post_url"],
        "mediaUrl": candidate["media_url"],
        "postedAt": candidate.get("posted_at"),
        "selectionStatus": candidate["status"],
        "segment": candidate["segment"],
        "occasion": candidate.get("occasion"),
        "occasionConfidence": candidate.get("occasion_confidence"),
        "ownershipConfidence": candidate.get("ownership_confidence"),
        "usConfidence": candidate.get("us_confidence"),
        "usEvidence": candidate.get("us_evidence"),
        "leadScore": candidate.get("score"),
        "likeCount": candidate.get("like_count", 0),
        "replyCount": candidate.get("reply_count", 0),
        "repostCount": candidate.get("repost_count", 0),
        "viewCount": candidate.get("view_count", 0),
        "followersCount": candidate.get("followers_count", 0),
        "targetingData": targeting,
        "consentCopy": copies["consent_copy"],
        "publicCopy": copies["public_copy"],
        "directMessageCopy": copies["dm_copy"],
    }


async def _report_remote_job(
    worker_id: str,
    job_id: str,
    status: str,
    received_count: int,
    candidates: list[dict[str, Any]],
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            f"{settings.diy_site_url}/api/x-leads/worker/jobs/{job_id}/complete",
            headers={"Authorization": f"Bearer {settings.worker_secret}"},
            json={
                "workerId": worker_id,
                "status": status,
                "receivedCount": received_count,
                "candidates": candidates,
                "errorCode": error_code,
                "errorMessage": error_message,
            },
        )
        response.raise_for_status()
