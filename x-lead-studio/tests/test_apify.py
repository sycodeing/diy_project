import json

from lead_studio.apify import build_actor_input, build_profile_input, index_apify_profiles, normalize_apify_items
from lead_studio.x_lead_worker import _cloud_candidate


def test_apify_video_thumbnail_is_not_treated_as_source_artwork():
    items = [{
        "tweetId": "210000000000000001",
        "url": "https://x.com/maple_home/status/210000000000000001",
        "text": "It is my dog's birthday today!",
        "createdAt": "2026-10-13T12:00:00Z",
        "likes": 20,
        "replies": 3,
        "retweets": 2,
        "views": 500,
        "isRetweet": False,
        "isReply": False,
        "photos": [],
        "videos": [{"thumbnailUrl": "https://pbs.twimg.com/media/maple.jpg"}],
        "authorHandle": "maple_home",
        "authorName": "Maple Home",
        "authorFollowers": 240,
        "authorVerified": False,
        "searchQuery": '("my dog\'s birthday") lang:en filter:media',
    }]

    _, candidates = normalize_apify_items(
        items,
        run_id="run-1",
        dataset_id="dataset-1",
        us_required=True,
        us_min_confidence=70,
    )

    assert candidates == []


def test_actor_input_uses_selected_segments_and_limit():
    payload = build_actor_input({
        "segments": ["new_adoption", "pet_birthday"],
        "resultLimit": 15,
        "lookbackDays": 7,
        "searchProduct": "Latest",
    })

    assert payload["maxItems"] == 15
    assert payload["maxTweetsPerQuery"] == 10
    assert len(payload["searchQueries"]) == 4
    assert all("filter:images" in query for query in payload["searchQueries"])
    assert sum("place_country:US" in query for query in payload["searchQueries"]) == 2


def test_profile_rows_enrich_location_and_account_origin():
    items = [{
        "tweetId": "210000000000000002",
        "text": "We adopted our new kitten today. Welcome home!",
        "createdAt": "2026-10-13T12:00:00Z",
        "isRetweet": False,
        "isReply": False,
        "photos": [{"url": "https://pbs.twimg.com/media/kitten.jpg"}],
        "authorHandle": "kitten_home",
        "searchQuery": '"we adopted" cat lang:en filter:media',
    }]
    profiles = index_apify_profiles([{
        "type": "profile",
        "handle": "kitten_home",
        "location": "Austin, TX",
        "accountBasedIn": "United States",
        "bio": "New cat parent",
        "followers": 120,
    }])

    _, candidates = normalize_apify_items(
        items,
        run_id="run-2",
        dataset_id="dataset-2",
        us_required=True,
        us_min_confidence=70,
        profiles=profiles,
        profile_run_id="profile-run-2",
    )

    assert candidates[0]["status"] == "new"
    assert candidates[0]["us_confidence"] == 96
    assert candidates[0]["us_evidence"] == "profile_and_account_based_in:US"
    source = json.loads(candidates[0]["targeting_json"])["source"]
    assert source["media_kind"] == "photo"
    assert source["photo_count"] == 1
    assert _cloud_candidate(candidates[0])["postId"] == items[0]["tweetId"]


def test_profile_actor_input_never_fetches_timelines():
    payload = build_profile_input(["one", "two"])
    assert payload["includeProfile"] is True
    assert payload["includeAccountOrigin"] is True
    assert payload["includeTweets"] is False
