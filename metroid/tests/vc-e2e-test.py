#!/usr/bin/env python3
"""
VibeCreature E2E Test Suite — Phases 1-8
Tests the backend API at http://localhost:3001 via HTTP requests.
Reports PASS/FAIL per test with summary.
"""

import json
import sys
import time
import base64
import urllib.request
import urllib.error
import urllib.parse
import random
import string

BASE = "http://localhost:3001/api"
PASS = 0
FAIL = 0
SKIP = 0
RESULTS = []

# State shared across phases
STATE = {
    "token": None,
    "user_id": None,
    "energy": 1000,
    "creature_ids": [],        # discovered creature IDs
    "friend_creature_id": None,
    "created_creature_id": None,
    "second_user_token": None,
}

TEST_EMAIL = f"testvc_{random.randint(1000,9999)}@test.com"
TEST_PASS = "TestPass123!"
TEST_USER = f"TestUser{random.randint(100,999)}"

SECOND_EMAIL = f"testvc2_{random.randint(1000,9999)}@test.com"


def req(method, path, body=None, token=None, raw=False, timeout=30):
    """Make an HTTP request. Returns (status_code, parsed_body)."""
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        code = resp.getcode()
        raw_body = resp.read().decode()
        if raw:
            return code, raw_body
        return code, json.loads(raw_body) if raw_body else {}
    except urllib.error.HTTPError as e:
        code = e.code
        raw_body = e.read().decode()
        try:
            return code, json.loads(raw_body)
        except Exception:
            return code, {"raw": raw_body}
    except Exception as e:
        return 0, {"error": str(e)}


def req_raw(method, path, raw_data=None, headers=None, timeout=10):
    """Raw request for edge cases (oversized body, etc.)."""
    url = f"{BASE}{path}"
    h = headers or {}
    r = urllib.request.Request(url, data=raw_data, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.getcode(), resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def test(test_id, description, passed, detail=""):
    global PASS, FAIL
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS += 1
    else:
        FAIL += 1
    line = f"  [{status}] {test_id}: {description}"
    if detail and not passed:
        line += f"  — {detail}"
    print(line)
    RESULTS.append({"id": test_id, "desc": description, "status": status, "detail": detail})


def skip(test_id, description, reason=""):
    global SKIP
    SKIP += 1
    line = f"  [SKIP] {test_id}: {description}"
    if reason:
        line += f"  — {reason}"
    print(line)
    RESULTS.append({"id": test_id, "desc": description, "status": "SKIP", "detail": reason})


# ═══════════════════════════════════════════════════════════════
# PHASE 1: Backend API Smoke Tests
# ═══════════════════════════════════════════════════════════════
def phase1():
    print("\n══ Phase 1: Backend API Smoke Tests ══")

    # P1-01: Health check
    code, body = req("GET", "/health")
    test("P1-01", "GET /api/health returns ok",
         code == 200 and body.get("status") == "ok" and body.get("version") == "1.0.0",
         f"code={code}, body={body}")

    # P1-02: 404 for nonexistent route
    code, body = req("GET", "/nonexistent")
    # Note: server has SPA fallback — non-/api routes return index.html
    # For /api/nonexistent, it should not match any route handler
    test("P1-02", "GET /api/nonexistent returns 404",
         code == 404,
         f"code={code}")

    # P1-03: OPTIONS preflight
    code, body = req("OPTIONS", "/health")
    test("P1-03", "OPTIONS /api/health returns 204",
         code == 204,
         f"code={code}")

    # P1-04: Discover without auth
    code, body = req("GET", "/creatures/discover")
    creatures = body if isinstance(body, list) else []
    test("P1-04", "GET /api/creatures/discover (no auth) returns creatures",
         code == 200 and isinstance(body, list) and len(body) >= 1,
         f"code={code}, count={len(creatures)}")

    # Store creature IDs for later
    if isinstance(body, list):
        STATE["creature_ids"] = [c.get("agentId") or c.get("agent_id") for c in body]

    # P1-05: /auth/me without token
    code, body = req("GET", "/auth/me")
    test("P1-05", "GET /api/auth/me (no token) returns 401",
         code == 401,
         f"code={code}, body={body}")

    # P1-06: /auth/me with bad token
    code, body = req("GET", "/auth/me", token="invalid.token.here")
    test("P1-06", "GET /api/auth/me (bad token) returns 401",
         code == 401,
         f"code={code}")

    # P1-07: Large request body >1MB
    big_body = "x" * (1024 * 1024 + 100)
    try:
        code, body = req_raw("POST", "/auth/register",
                             raw_data=big_body.encode(),
                             headers={"Content-Type": "application/json"},
                             timeout=5)
        # Connection should be destroyed or return error
        test("P1-07", "Large request body >1MB rejected",
             code != 200 and code != 201,
             f"code={code}")
    except Exception as e:
        # Connection reset is expected
        test("P1-07", "Large request body >1MB rejected",
             True,
             f"Connection error (expected): {e}")


# ═══════════════════════════════════════════════════════════════
# PHASE 2: Auth Flow
# ═══════════════════════════════════════════════════════════════
def phase2():
    print("\n══ Phase 2: Auth Flow ══")

    # P2-01: Register
    code, body = req("POST", "/auth/register", {
        "username": TEST_USER,
        "email": TEST_EMAIL,
        "password": TEST_PASS
    })
    test("P2-01", "Register new user",
         code == 201 and "token" in body and "user" in body,
         f"code={code}, keys={list(body.keys()) if isinstance(body, dict) else body}")

    if code == 201:
        STATE["token"] = body["token"]
        STATE["user_id"] = body["user"]["id"]
        user = body["user"]
        energy_ok = user.get("energy") == 1000
        tier_ok = user.get("membershipTier", user.get("membership_tier")) == "free"
        test("P2-01b", "Register: energy=1000, tier=free",
             energy_ok and tier_ok,
             f"energy={user.get('energy')}, tier={user.get('membershipTier', user.get('membership_tier'))}")
    else:
        skip("P2-01b", "Register details check", "registration failed")

    # P2-02: Duplicate email
    code, body = req("POST", "/auth/register", {
        "username": "DupeUser",
        "email": TEST_EMAIL,
        "password": "whatever123"
    })
    test("P2-02", "Register duplicate email returns 400",
         code == 400 and "already registered" in body.get("error", "").lower(),
         f"code={code}, error={body.get('error')}")

    # P2-03: Register missing fields
    code, body = req("POST", "/auth/register", {"username": "NoEmail"})
    test("P2-03", "Register missing fields returns 400",
         code == 400,
         f"code={code}")

    # P2-04: Login correct credentials
    code, body = req("POST", "/auth/login", {
        "email": TEST_EMAIL,
        "password": TEST_PASS
    })
    test("P2-04", "Login correct credentials returns 200",
         code == 200 and "token" in body,
         f"code={code}")
    if code == 200:
        STATE["token"] = body["token"]  # use fresh token

    # P2-05: Login wrong password
    code, body = req("POST", "/auth/login", {
        "email": TEST_EMAIL,
        "password": "WrongPass999"
    })
    test("P2-05", "Login wrong password returns 401",
         code == 401,
         f"code={code}")

    # P2-06: Login nonexistent email
    code, body = req("POST", "/auth/login", {
        "email": "nonexist@nowhere.com",
        "password": "anything"
    })
    test("P2-06", "Login nonexistent email returns 401",
         code == 401,
         f"code={code}")

    # P2-07: Login missing fields
    code, body = req("POST", "/auth/login", {"email": TEST_EMAIL})
    test("P2-07", "Login missing fields returns 400",
         code == 400,
         f"code={code}")

    # P2-08: Validate token via /auth/me
    if STATE["token"]:
        code, body = req("GET", "/auth/me", token=STATE["token"])
        test("P2-08", "Validate token via /auth/me",
             code == 200 and body.get("id") == STATE["user_id"],
             f"code={code}, id_match={body.get('id') == STATE['user_id']}")
    else:
        skip("P2-08", "Validate token", "no token")

    # P2-09: JWT has 7-day expiry
    if STATE["token"]:
        try:
            parts = STATE["token"].split(".")
            # Decode payload (add padding)
            payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            diff = payload.get("exp", 0) - payload.get("iat", 0)
            test("P2-09", "JWT has 7-day expiry (exp-iat=604800)",
                 diff == 604800,
                 f"exp-iat={diff}")
        except Exception as e:
            test("P2-09", "JWT has 7-day expiry", False, str(e))
    else:
        skip("P2-09", "JWT expiry check", "no token")


# ═══════════════════════════════════════════════════════════════
# PHASE 3: Discover + Friends
# ═══════════════════════════════════════════════════════════════
def phase3():
    print("\n══ Phase 3: Discover + Friends ══")
    token = STATE["token"]

    # P3-01: Discover returns creatures with expected fields
    code, body = req("GET", "/creatures/discover")
    creatures = body if isinstance(body, list) else []
    has_fields = all(
        c.get("agentId") and c.get("name") and c.get("greeting") is not None
        for c in creatures
    ) if creatures else False
    test("P3-01", "Discover returns creatures with agentId, name, greeting",
         code == 200 and len(creatures) >= 1 and has_fields,
         f"code={code}, count={len(creatures)}, fields_ok={has_fields}")

    # Update creature IDs
    if isinstance(body, list) and body:
        STATE["creature_ids"] = [c["agentId"] for c in body if c.get("agentId")]

    # P3-02: Filter gender=Female
    code, body = req("GET", "/creatures/discover?gender=Female")
    female_list = body if isinstance(body, list) else []
    test("P3-02", "Filter gender=Female returns results",
         code == 200 and isinstance(body, list) and len(female_list) >= 1,
         f"code={code}, count={len(female_list)}")

    # P3-03: Filter occupation=Hacker
    code, body = req("GET", "/creatures/discover?occupation=Hacker")
    hacker_list = body if isinstance(body, list) else []
    test("P3-03", "Filter occupation=Hacker returns results",
         code == 200 and isinstance(body, list),
         f"code={code}, count={len(hacker_list)}")

    # P3-04: Discover limit=2
    code, body = req("GET", "/creatures/discover?limit=2")
    limited = body if isinstance(body, list) else []
    test("P3-04", "Discover limit=2 returns <=2 results",
         code == 200 and isinstance(body, list) and len(limited) <= 2,
         f"code={code}, count={len(limited)}")

    # P3-05: Get specific creature by ID
    if STATE["creature_ids"]:
        cid = STATE["creature_ids"][0]
        code, body = req("GET", f"/creatures/{cid}", token=token)
        test("P3-05", "Get specific creature by ID",
             code == 200 and (body.get("agentId") == cid or body.get("name")),
             f"code={code}, id={body.get('agentId')}")
    else:
        skip("P3-05", "Get creature by ID", "no creature IDs")

    # P3-06: Get nonexistent creature
    code, body = req("GET", "/creatures/nonexistent-id-00000", token=token)
    test("P3-06", "Get nonexistent creature returns 404",
         code == 404,
         f"code={code}")

    # P3-07: Add friend
    if STATE["creature_ids"]:
        cid = STATE["creature_ids"][0]
        STATE["friend_creature_id"] = cid
        code, body = req("POST", "/user/friends", {"creature_id": cid}, token=token)
        test("P3-07", "Add friend",
             code == 201 and body.get("id"),
             f"code={code}, body={body}")
    else:
        skip("P3-07", "Add friend", "no creature IDs")

    # P3-08: Add duplicate friend
    if STATE["friend_creature_id"]:
        code, body = req("POST", "/user/friends",
                         {"creature_id": STATE["friend_creature_id"]}, token=token)
        test("P3-08", "Add duplicate friend returns 400",
             code == 400 and "already" in body.get("error", "").lower(),
             f"code={code}, error={body.get('error')}")
    else:
        skip("P3-08", "Duplicate friend", "no friend added")

    # P3-09: List friends
    code, body = req("GET", "/user/friends", token=token)
    friends_list = body if isinstance(body, list) else []
    test("P3-09", "List friends returns array",
         code == 200 and isinstance(body, list) and len(friends_list) >= 1,
         f"code={code}, count={len(friends_list)}")

    # P3-10: Remove friend
    if STATE["friend_creature_id"]:
        cid = STATE["friend_creature_id"]
        code, body = req("DELETE", f"/user/friends/{cid}", token=token)
        test("P3-10", "Remove friend returns ok",
             code == 200 and body.get("ok") == True,
             f"code={code}, body={body}")
    else:
        skip("P3-10", "Remove friend", "no friend to remove")


# ═══════════════════════════════════════════════════════════════
# PHASE 4: Chat + LLM
# ═══════════════════════════════════════════════════════════════
def phase4():
    print("\n══ Phase 4: Chat + LLM ══")
    token = STATE["token"]

    # Need a creature to chat with — re-add as friend first
    if not STATE["creature_ids"]:
        skip("P4-*", "Chat tests", "no creature IDs available")
        return

    cid = STATE["creature_ids"][0]
    # Re-add friend for chat
    req("POST", "/user/friends", {"creature_id": cid}, token=token)

    # Get initial energy
    code, profile = req("GET", "/user/profile", token=token)
    initial_energy = profile.get("energy", 0) if code == 200 else 1000

    # P4-01: Send first message
    code, body = req("POST", f"/chat/{cid}/send", {"content": "Hello! Tell me about yourself."}, token=token, timeout=60)
    test("P4-01", "Send first message returns AI reply",
         code == 200 and body.get("reply", {}).get("content"),
         f"code={code}, has_reply={bool(body.get('reply', {}).get('content'))}")

    # P4-02: Energy deducted by 2
    if code == 200 and body.get("energyRemaining") is not None:
        expected = initial_energy - 2
        actual = body["energyRemaining"]
        test("P4-02", "Energy deducted by 2 after chat",
             actual == expected,
             f"expected={expected}, actual={actual}")
        STATE["energy"] = actual
    else:
        skip("P4-02", "Energy deduction", f"code={code}")

    # P4-03: Get chat history
    code, body = req("GET", f"/chat/{cid}/messages", token=token)
    msgs = body.get("messages", []) if isinstance(body, dict) else []
    test("P4-03", "Get chat history returns messages",
         code == 200 and len(msgs) >= 2,
         f"code={code}, count={len(msgs)}")

    has_user = any(m.get("role") == "user" for m in msgs)
    has_asst = any(m.get("role") == "assistant" for m in msgs)
    test("P4-03b", "History has both user and assistant messages",
         has_user and has_asst,
         f"user={has_user}, assistant={has_asst}")

    # P4-04: Send second message
    code, body = req("POST", f"/chat/{cid}/send", {"content": "What did I just ask you about?"}, token=token, timeout=60)
    test("P4-04", "Send second message returns reply",
         code == 200 and body.get("reply", {}).get("content"),
         f"code={code}")

    # P4-05: History limit=1
    code, body = req("GET", f"/chat/{cid}/messages?limit=1", token=token)
    msgs = body.get("messages", []) if isinstance(body, dict) else []
    test("P4-05", "History limit=1 returns 1 message",
         code == 200 and len(msgs) == 1,
         f"code={code}, count={len(msgs)}")

    # P4-06: Clear chat
    code, body = req("DELETE", f"/chat/{cid}", token=token)
    test("P4-06", "Clear chat returns ok",
         code == 200 and body.get("ok") == True,
         f"code={code}, body={body}")

    # P4-07: Verify history cleared
    code, body = req("GET", f"/chat/{cid}/messages", token=token)
    msgs = body.get("messages", []) if isinstance(body, dict) else []
    test("P4-07", "History cleared — empty messages",
         code == 200 and len(msgs) == 0,
         f"code={code}, count={len(msgs)}")

    # P4-08: Send without content field
    code, body = req("POST", f"/chat/{cid}/send", {}, token=token)
    test("P4-08", "Send without content returns 400",
         code == 400,
         f"code={code}, error={body.get('error')}")

    # P4-09: Send empty string
    code, body = req("POST", f"/chat/{cid}/send", {"content": ""}, token=token)
    test("P4-09", "Send empty string returns 400",
         code == 400,
         f"code={code}, error={body.get('error')}")

    # P4-10: Energy transactions audit
    code, body = req("GET", "/user/energy", token=token)
    if code == 200:
        txns = body.get("transactions", [])
        types_present = {t.get("type") for t in txns}
        has_chat_send = "chat_send" in types_present
        has_chat_reply = "chat_reply" in types_present
        test("P4-10", "Energy transactions include chat_send and chat_reply",
             has_chat_send and has_chat_reply,
             f"types={types_present}")
    else:
        test("P4-10", "Energy transactions audit", False, f"code={code}")


# ═══════════════════════════════════════════════════════════════
# PHASE 5: Create Creature
# ═══════════════════════════════════════════════════════════════
def phase5():
    print("\n══ Phase 5: Create Creature ══")
    token = STATE["token"]

    # Get energy before creation
    code, profile = req("GET", "/user/profile", token=token)
    energy_before = profile.get("energy", 0) if code == 200 else 0

    # P5-01: Create creature
    code, body = req("POST", "/creatures", {
        "name": "TestCreature",
        "card": {
            "description": "A test creature for E2E testing",
            "personality": "Friendly, helpful, and curious",
            "firstMes": "Hi! I'm a test creature. How can I help?",
            "scenario": "You meet a friendly test creature in a lab."
        },
        "metadata": {
            "gender": "Non-binary",
            "age": 5,
            "bio": "Created by E2E tests",
            "tags": ["test", "e2e"],
            "occupation": "Tester",
            "photos": [],
            "appearanceStyle": "minimalist"
        }
    }, token=token)
    created_id = body.get("agentId") or body.get("agent_id")
    test("P5-01", "Create creature returns 201 with agentId",
         code == 201 and created_id,
         f"code={code}, id={created_id}")

    if created_id:
        STATE["created_creature_id"] = created_id

    # P5-02: 100 energy deducted
    code2, profile2 = req("GET", "/user/profile", token=token)
    if code2 == 200:
        energy_after = profile2.get("energy", 0)
        test("P5-02", "100 energy deducted for creature creation",
             energy_before - energy_after == 100,
             f"before={energy_before}, after={energy_after}, diff={energy_before - energy_after}")
    else:
        skip("P5-02", "Energy deduction check", "profile fetch failed")

    # Check for 'create' transaction type
    code3, energy_data = req("GET", "/user/energy", token=token)
    if code3 == 200:
        types = {t.get("type") for t in energy_data.get("transactions", [])}
        test("P5-02b", "Transaction type 'create' present",
             "create" in types,
             f"types={types}")
    else:
        skip("P5-02b", "Transaction type check", "energy fetch failed")

    # P5-03: New creature in discover
    code, body = req("GET", "/creatures/discover")
    creatures = body if isinstance(body, list) else []
    found = any(c.get("agentId") == created_id for c in creatures)
    test("P5-03", "New creature appears in discover",
         code == 200 and found,
         f"code={code}, found={found}, total={len(creatures)}")

    # P5-04: Create missing fields
    code, body = req("POST", "/creatures", {"name": "Incomplete"}, token=token)
    test("P5-04", "Create creature missing fields returns 400",
         code == 400,
         f"code={code}, error={body.get('error')}")

    # P5-05: Delete own creature
    if STATE["created_creature_id"]:
        code, body = req("DELETE", f"/creatures/{STATE['created_creature_id']}", token=token)
        test("P5-05", "Delete own creature returns 200",
             code == 200 and body.get("ok") == True,
             f"code={code}, body={body}")
    else:
        skip("P5-05", "Delete own creature", "no creature created")

    # P5-06: Delete creature not owned (use a seed creature)
    if STATE["creature_ids"]:
        cid = STATE["creature_ids"][0]
        code, body = req("DELETE", f"/creatures/{cid}", token=token)
        test("P5-06", "Delete creature not owned returns 403",
             code == 403,
             f"code={code}, error={body.get('error')}")
    else:
        skip("P5-06", "Delete not-owned creature", "no creature IDs")


# ═══════════════════════════════════════════════════════════════
# PHASE 6: Profile & Energy
# ═══════════════════════════════════════════════════════════════
def phase6():
    print("\n══ Phase 6: Profile & Energy ══")
    token = STATE["token"]

    # P6-01: Get profile
    code, body = req("GET", "/user/profile", token=token)
    has_fields = all(body.get(f) is not None for f in ["username", "energy", "membershipTier"])
    test("P6-01", "Get profile returns expected fields",
         code == 200 and has_fields,
         f"code={code}, fields={list(body.keys()) if isinstance(body, dict) else 'N/A'}")

    # P6-02: Update username
    new_name = f"Updated_{random.randint(100,999)}"
    code, body = req("PUT", "/user/profile", {"username": new_name}, token=token)
    test("P6-02", "Update username succeeds",
         code == 200,
         f"code={code}")
    # Verify
    code2, body2 = req("GET", "/user/profile", token=token)
    test("P6-02b", "Username actually updated",
         code2 == 200 and body2.get("username") == new_name,
         f"expected={new_name}, got={body2.get('username')}")

    # P6-03: Daily checkin
    code, body = req("POST", "/user/energy/daily-checkin", token=token)
    test("P6-03", "Daily checkin awards +50 energy",
         code == 200 and body.get("energyGained") == 50,
         f"code={code}, body={body}")

    # P6-04: Duplicate checkin same day
    code, body = req("POST", "/user/energy/daily-checkin", token=token)
    test("P6-04", "Duplicate checkin returns 400",
         code == 400 and "already" in body.get("error", "").lower(),
         f"code={code}, error={body.get('error')}")

    # P6-05: Energy transaction history
    code, body = req("GET", "/user/energy", token=token)
    if code == 200:
        txn_types = {t.get("type") for t in body.get("transactions", [])}
        test("P6-05", "Energy transaction history has multiple types",
             len(txn_types) >= 2,
             f"types={txn_types}")
    else:
        test("P6-05", "Energy transaction history", False, f"code={code}")


# ═══════════════════════════════════════════════════════════════
# PHASE 7: Feed Endpoints
# ═══════════════════════════════════════════════════════════════
def phase7():
    print("\n══ Phase 7: Feed Endpoints ══")
    token = STATE["token"]

    # P7-01: Get feed (recommended)
    code, body = req("GET", "/feed?tab=recommended", token=token)
    feed = body if isinstance(body, list) else []
    test("P7-01", "Get feed (recommended) returns array",
         code == 200 and isinstance(body, list),
         f"code={code}, count={len(feed)}")

    # P7-02: Get feed (following)
    code, body = req("GET", "/feed?tab=following", token=token)
    test("P7-02", "Get feed (following) returns array",
         code == 200 and isinstance(body, list),
         f"code={code}")

    # P7-03: Get nonexistent post
    code, body = req("GET", "/feed/nonexistent-post-id", token=token)
    test("P7-03", "Get nonexistent post returns 404",
         code == 404,
         f"code={code}")

    # P7-04: POST /api/feed (no create endpoint)
    code, body = req("POST", "/feed", {"content": "test"}, token=token)
    test("P7-04", "POST /api/feed returns 404 (no endpoint)",
         code == 404,
         f"code={code}")


# ═══════════════════════════════════════════════════════════════
# PHASE 8: Edge Cases
# ═══════════════════════════════════════════════════════════════
def phase8():
    print("\n══ Phase 8: Edge Cases ══")
    token = STATE["token"]

    # P8-01: Malformed JWT
    code, body = req("GET", "/auth/me", token="not.a.jwt.at.all")
    test("P8-01", "Malformed JWT returns 401",
         code == 401,
         f"code={code}")

    # P8-02: SQL injection in filter
    injected = urllib.parse.quote("' OR 1=1 --")
    code, body = req("GET", f"/creatures/discover?gender={injected}")
    test("P8-02", "SQL injection in filter — no error",
         code == 200 and isinstance(body, list),
         f"code={code}")

    # P8-03: Missing creature_id in add friend
    code, body = req("POST", "/user/friends", {}, token=token)
    test("P8-03", "Missing creature_id in add friend returns 400",
         code == 400,
         f"code={code}, error={body.get('error')}")

    # P8-04: Chat with nonexistent creature
    code, body = req("POST", "/chat/nonexistent-creature-id/send",
                     {"content": "hello"}, token=token, timeout=15)
    test("P8-04", "Chat with nonexistent creature returns error (not crash)",
         code != 200 and code != 0,
         f"code={code}")

    # P8-05: Friend limit enforcement (free=3)
    # Need to add 3 friends, then try a 4th
    # First, clean up — remove any existing friends
    code, friends = req("GET", "/user/friends", token=token)
    if code == 200 and isinstance(friends, list):
        for f in friends:
            cid = f.get("creatureId") or f.get("creature_id") or (f.get("creature", {}) or {}).get("agentId")
            if cid:
                req("DELETE", f"/user/friends/{cid}", token=token)

    # Get available creatures
    code, all_creatures = req("GET", "/creatures/discover")
    available = [c["agentId"] for c in (all_creatures if isinstance(all_creatures, list) else []) if c.get("agentId")]

    if len(available) >= 4:
        # Add 3 friends
        for i in range(3):
            req("POST", "/user/friends", {"creature_id": available[i]}, token=token)

        # Try 4th
        code, body = req("POST", "/user/friends", {"creature_id": available[3]}, token=token)
        test("P8-05", "4th friend blocked by free tier limit (3)",
             code == 400 and "limit" in body.get("error", "").lower(),
             f"code={code}, error={body.get('error')}")

        # Cleanup: remove friends so they don't affect other tests
        for i in range(3):
            req("DELETE", f"/user/friends/{available[i]}", token=token)
    else:
        skip("P8-05", "Friend limit enforcement", f"Need 4 creatures, have {len(available)}")


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════
def main():
    print("=" * 60)
    print("  VibeCreature E2E Test Suite")
    print(f"  Target: {BASE}")
    print(f"  Test account: {TEST_EMAIL}")
    print("=" * 60)

    # Connectivity check
    try:
        code, _ = req("GET", "/health", timeout=5)
        if code != 200:
            print(f"\n  ERROR: Backend not reachable (code={code})")
            print("  Make sure the server is running at http://localhost:3001")
            sys.exit(1)
    except Exception as e:
        print(f"\n  ERROR: Cannot connect to backend: {e}")
        print("  Make sure the server is running at http://localhost:3001")
        sys.exit(1)

    print("\n  Backend is UP. Starting tests...\n")

    start = time.time()

    phase1()
    phase2()
    phase3()
    phase4()
    phase5()
    phase6()
    phase7()
    phase8()

    elapsed = time.time() - start

    # Summary
    total = PASS + FAIL + SKIP
    print("\n" + "=" * 60)
    print(f"  RESULTS: {PASS} passed, {FAIL} failed, {SKIP} skipped / {total} total")
    print(f"  Time: {elapsed:.1f}s")
    print("=" * 60)

    if FAIL > 0:
        print("\n  FAILURES:")
        for r in RESULTS:
            if r["status"] == "FAIL":
                print(f"    {r['id']}: {r['desc']}")
                if r["detail"]:
                    print(f"      → {r['detail']}")

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
