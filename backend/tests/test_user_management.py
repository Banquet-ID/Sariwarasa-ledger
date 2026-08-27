"""
Backend tests for User Management feature (Settings page).
Endpoints: GET/POST /api/users, PUT /api/users/{id}/role, DELETE /api/users/{id}
All owner-only. Self-protection: cannot change own role / delete self.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "andhry.adhriyanto@gmail.com"
OWNER_PASS = os.environ.get("TEST_OWNER_PASSWORD", "")
TEAM_EMAIL = "team@sariwarasa.com"
TEAM_PASS = os.environ.get("TEST_TEAM_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def owner():
    d = _login(OWNER_EMAIL, OWNER_PASS)
    return {"token": d["token"], "user": d["user"]}


@pytest.fixture(scope="module")
def team():
    d = _login(TEAM_EMAIL, TEAM_PASS)
    return {"token": d["token"], "user": d["user"]}


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Auth guard ---------------- #
def test_team_cannot_list_users(team):
    r = requests.get(f"{API}/users", headers=_headers(team["token"]), timeout=15)
    assert r.status_code == 403, r.text


def test_unauthenticated_users_401(owner):
    r = requests.get(f"{API}/users", timeout=15)
    assert r.status_code in (401, 403)


# ---------------- List ---------------- #
def test_owner_can_list_users(owner):
    r = requests.get(f"{API}/users", headers=_headers(owner["token"]), timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "users" in data and isinstance(data["users"], list)
    emails = [u["email"] for u in data["users"]]
    assert OWNER_EMAIL in emails
    # ensure password_hash not leaked
    for u in data["users"]:
        assert "password_hash" not in u
        assert "_id" not in u


# ---------------- Create + Validation ---------------- #
@pytest.fixture(scope="module")
def created_user(owner):
    """Create a TEST_ user for lifecycle tests; cleanup afterwards."""
    suffix = uuid.uuid4().hex[:8]
    email = f"test_user_{suffix}@sariwarasa.com"  # backend lowercases
    payload = {"name": f"TEST User {suffix}", "email": email, "password": "abcdef", "role": "team"}
    r = requests.post(f"{API}/users", headers=_headers(owner["token"]), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == email
    assert body["role"] == "team"
    assert "user_id" in body
    user_id = body["user_id"]
    yield {"user_id": user_id, "email": email, "password": "abcdef", "name": payload["name"]}
    # cleanup
    requests.delete(f"{API}/users/{user_id}", headers=_headers(owner["token"]), timeout=15)


def test_create_user_persisted(owner, created_user):
    r = requests.get(f"{API}/users", headers=_headers(owner["token"]), timeout=15)
    users = r.json()["users"]
    match = [u for u in users if u["user_id"] == created_user["user_id"]]
    assert match, "created user not found in listing"
    assert match[0]["email"] == created_user["email"]


def test_created_user_can_login(created_user):
    r = requests.post(f"{API}/auth/login",
                      json={"email": created_user["email"], "password": created_user["password"]},
                      timeout=15)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "team"


def test_create_user_short_password_400(owner):
    r = requests.post(f"{API}/users", headers=_headers(owner["token"]),
                      json={"name": "TEST_short", "email": f"TEST_short_{uuid.uuid4().hex[:6]}@x.com",
                            "password": "abc", "role": "team"}, timeout=15)
    assert r.status_code == 400
    assert "6" in r.json().get("detail", "")


def test_create_user_duplicate_email_400(owner, created_user):
    r = requests.post(f"{API}/users", headers=_headers(owner["token"]),
                      json={"name": "dup", "email": created_user["email"],
                            "password": "abcdef", "role": "team"}, timeout=15)
    assert r.status_code == 400


def test_team_cannot_create_user(team):
    r = requests.post(f"{API}/users", headers=_headers(team["token"]),
                      json={"name": "x", "email": "TEST_forbid@x.com", "password": "abcdef", "role": "team"},
                      timeout=15)
    assert r.status_code == 403


# ---------------- Role Update ---------------- #
def test_update_role_team_to_owner_grants_write(owner, created_user):
    # Change role team -> owner
    r = requests.put(f"{API}/users/{created_user['user_id']}/role",
                     headers=_headers(owner["token"]), json={"role": "owner"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "owner"

    # New user re-login to get updated role in token
    login = _login(created_user["email"], created_user["password"])
    assert login["user"]["role"] == "owner"

    # Try creating a transaction (owner-only) → should NOT be 403
    tx_payload = {
        "type": "expense",
        "date": "2026-01-15",
        "amount": 1000,
        "category": "Operasional",
        "fund_source": "Cash",
        "description": "TEST tx from promoted user",
    }
    r2 = requests.post(f"{API}/transactions", headers=_headers(login["token"]),
                       json=tx_payload, timeout=20)
    # Accept 200/201 as success; must not be 403
    assert r2.status_code != 403, f"promoted user still forbidden: {r2.status_code} {r2.text}"
    if r2.status_code in (200, 201):
        tx_id = r2.json().get("id") or r2.json().get("transaction", {}).get("id")
        if tx_id:
            requests.delete(f"{API}/transactions/{tx_id}",
                            headers=_headers(login["token"]), timeout=15)

    # Revert to team
    requests.put(f"{API}/users/{created_user['user_id']}/role",
                 headers=_headers(owner["token"]), json={"role": "team"}, timeout=15)


def test_owner_cannot_change_own_role(owner):
    r = requests.put(f"{API}/users/{owner['user']['user_id']}/role",
                     headers=_headers(owner["token"]), json={"role": "team"}, timeout=15)
    assert r.status_code == 400


def test_update_role_invalid_400(owner, created_user):
    r = requests.put(f"{API}/users/{created_user['user_id']}/role",
                     headers=_headers(owner["token"]), json={"role": "admin"}, timeout=15)
    assert r.status_code == 400


def test_update_role_unknown_user_404(owner):
    r = requests.put(f"{API}/users/nonexistent_id/role",
                     headers=_headers(owner["token"]), json={"role": "team"}, timeout=15)
    assert r.status_code == 404


def test_team_cannot_update_role(team, created_user):
    r = requests.put(f"{API}/users/{created_user['user_id']}/role",
                     headers=_headers(team["token"]), json={"role": "owner"}, timeout=15)
    assert r.status_code == 403


# ---------------- Delete + self-protect ---------------- #
def test_owner_cannot_delete_self(owner):
    r = requests.delete(f"{API}/users/{owner['user']['user_id']}",
                        headers=_headers(owner["token"]), timeout=15)
    assert r.status_code == 400


def test_delete_unknown_user_404(owner):
    r = requests.delete(f"{API}/users/nonexistent_xyz",
                        headers=_headers(owner["token"]), timeout=15)
    assert r.status_code == 404


def test_delete_user_and_login_fails(owner):
    # Create a throwaway user, delete it, then attempt login -> 401
    suffix = uuid.uuid4().hex[:8]
    email = f"test_del_{suffix}@x.com"
    r = requests.post(f"{API}/users", headers=_headers(owner["token"]),
                      json={"name": "TEST del", "email": email, "password": "abcdef", "role": "team"},
                      timeout=15)
    assert r.status_code == 200
    uid = r.json()["user_id"]

    # confirm login works pre-delete
    lg = requests.post(f"{API}/auth/login", json={"email": email, "password": "abcdef"}, timeout=15)
    assert lg.status_code == 200

    # delete
    d = requests.delete(f"{API}/users/{uid}", headers=_headers(owner["token"]), timeout=15)
    assert d.status_code == 200

    # verify removed from listing
    lst = requests.get(f"{API}/users", headers=_headers(owner["token"]), timeout=15).json()["users"]
    assert not any(u["user_id"] == uid for u in lst)

    # login after delete → 401
    lg2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "abcdef"}, timeout=15)
    assert lg2.status_code == 401


def test_team_cannot_delete_user(team, created_user):
    r = requests.delete(f"{API}/users/{created_user['user_id']}",
                        headers=_headers(team["token"]), timeout=15)
    assert r.status_code == 403


# ---------------- Audit log ---------------- #
def test_audit_log_records_user_actions(owner):
    r = requests.get(f"{API}/audit-logs", headers=_headers(owner["token"]), timeout=15)
    assert r.status_code == 200
    logs = r.json()["logs"]
    actions_on_user = [l for l in logs if l.get("entity") == "user"]
    assert actions_on_user, "no audit logs for entity=user found"
    action_names = {l["action"] for l in actions_on_user}
    # We should have created and updated_role and delete traces from this run
    assert "create" in action_names
    # Prior tests exercised update_role and delete
    assert {"update_role", "delete"} & action_names
