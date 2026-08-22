"""Backend API tests for Sariwarasa finance app."""
import os
import io
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://sariwarasa-ledger.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "andhry.adhriyanto@gmail.com"
OWNER_PW = "sariwarasa123"
TEAM_EMAIL = "team@sariwarasa.com"
TEAM_PW = "sariwarasa123"

TODAY = datetime.utcnow().strftime("%Y-%m-%d")
MONTH = datetime.utcnow().strftime("%Y-%m")


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PW}, timeout=15)
    assert r.status_code == 200, f"Owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def team_token():
    r = requests.post(f"{API}/auth/login", json={"email": TEAM_EMAIL, "password": TEAM_PW}, timeout=15)
    assert r.status_code == 200, f"Team login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture
def team_headers(team_token):
    return {"Authorization": f"Bearer {team_token}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_login_owner(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PW})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["user"]["role"] == "owner"

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, owner_headers):
        r = requests.get(f"{API}/auth/me", headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["email"] == OWNER_EMAIL

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------------- RBAC (team read-only) ----------------
class TestRBAC:
    def test_team_can_get_transactions(self, team_headers):
        r = requests.get(f"{API}/transactions", headers=team_headers)
        assert r.status_code == 200

    def test_team_can_get_balances(self, team_headers):
        r = requests.get(f"{API}/balances", headers=team_headers)
        assert r.status_code == 200

    def test_team_cannot_create_transaction(self, team_headers):
        payload = {"type": "income", "amount": 1000, "date": TODAY,
                   "category": "Catering", "fund_source": "Cash", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=team_headers, json=payload)
        assert r.status_code == 403

    def test_team_cannot_create_debt(self, team_headers):
        r = requests.post(f"{API}/debts", headers=team_headers,
                          json={"type": "hutang", "party": "TEST", "amount": 1000, "date": TODAY})
        assert r.status_code == 403

    def test_team_cannot_access_audit(self, team_headers):
        r = requests.get(f"{API}/audit-logs", headers=team_headers)
        assert r.status_code == 403


# ---------------- Meta ----------------
class TestMeta:
    def test_meta(self, owner_headers):
        r = requests.get(f"{API}/meta", headers=owner_headers)
        assert r.status_code == 200
        data = r.json()
        assert "Cash" in data["fund_sources"]
        assert "Lainnya" in data["expense_categories"]


# ---------------- Transactions ----------------
class TestTransactions:
    def test_create_income_and_balance_updates(self, owner_headers):
        b0 = requests.get(f"{API}/balances", headers=owner_headers).json()
        cash0 = next(b["balance"] for b in b0["balances"] if b["name"] == "Cash")

        payload = {"type": "income", "amount": 12345, "date": TODAY,
                   "category": "Catering", "fund_source": "Cash",
                   "notes": "TEST_income", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r.status_code == 200, r.text
        tx = r.json()["transaction"]
        assert tx["amount"] == 12345
        tx_id = tx["id"]

        # verify persisted
        listing = requests.get(f"{API}/transactions", headers=owner_headers).json()
        assert any(t["id"] == tx_id for t in listing["transactions"])

        b1 = requests.get(f"{API}/balances", headers=owner_headers).json()
        cash1 = next(b["balance"] for b in b1["balances"] if b["name"] == "Cash")
        assert cash1 == pytest.approx(cash0 + 12345)

        # cleanup
        d = requests.delete(f"{API}/transactions/{tx_id}", headers=owner_headers)
        assert d.status_code == 200

    def test_lainnya_requires_notes(self, owner_headers):
        # without notes -> 400
        payload = {"type": "expense", "amount": 500, "date": TODAY,
                   "category": "Lainnya", "fund_source": "Cash", "notes": "", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r.status_code == 400
        assert "catatan" in r.json()["detail"].lower()

        # with notes -> success
        payload["notes"] = "TEST_lainnya with notes"
        r2 = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r2.status_code == 200
        requests.delete(f"{API}/transactions/{r2.json()['transaction']['id']}", headers=owner_headers)

    def test_transfer_updates_two_balances(self, owner_headers):
        b0 = requests.get(f"{API}/balances", headers=owner_headers).json()["balances"]
        bca1_0 = next(b["balance"] for b in b0 if b["name"] == "BCA 1")
        cash0 = next(b["balance"] for b in b0 if b["name"] == "Cash")

        payload = {"type": "transfer", "amount": 7000, "date": TODAY,
                   "fund_source": "BCA 1", "to_fund_source": "Cash",
                   "notes": "TEST_transfer", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r.status_code == 200
        tx_id = r.json()["transaction"]["id"]

        b1 = requests.get(f"{API}/balances", headers=owner_headers).json()["balances"]
        bca1_1 = next(b["balance"] for b in b1 if b["name"] == "BCA 1")
        cash1 = next(b["balance"] for b in b1 if b["name"] == "Cash")
        assert bca1_1 == pytest.approx(bca1_0 - 7000)
        assert cash1 == pytest.approx(cash0 + 7000)

        requests.delete(f"{API}/transactions/{tx_id}", headers=owner_headers)

    def test_events_requires_fields(self, owner_headers):
        payload = {"type": "income", "amount": 1000, "date": TODAY,
                   "category": "Events", "fund_source": "Cash", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r.status_code == 400

        payload.update({"event_name": "TEST_Event", "event_location": "Bandung", "event_pic": "PIC"})
        r2 = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        assert r2.status_code == 200

        # Event should appear in events endpoint
        ev = requests.get(f"{API}/events", headers=owner_headers).json()
        assert any(e["id"] == r2.json()["transaction"]["id"] for e in ev["events"])

        requests.delete(f"{API}/transactions/{r2.json()['transaction']['id']}", headers=owner_headers)

    def test_edit_transaction(self, owner_headers):
        payload = {"type": "expense", "amount": 111, "date": TODAY,
                   "category": "Buah", "fund_source": "Cash",
                   "notes": "TEST_edit", "status": "final"}
        r = requests.post(f"{API}/transactions", headers=owner_headers, json=payload)
        tx_id = r.json()["transaction"]["id"]

        payload["amount"] = 222
        u = requests.put(f"{API}/transactions/{tx_id}", headers=owner_headers, json=payload)
        assert u.status_code == 200
        assert u.json()["transaction"]["amount"] == 222

        requests.delete(f"{API}/transactions/{tx_id}", headers=owner_headers)


# ---------------- Debts ----------------
class TestDebts:
    def test_debt_hutang_full_flow(self, owner_headers):
        # Create hutang
        r = requests.post(f"{API}/debts", headers=owner_headers,
                          json={"type": "hutang", "party": "TEST_Supplier", "amount": 10000,
                                "date": TODAY, "notes": "TEST"})
        assert r.status_code == 200
        debt = r.json()
        debt_id = debt["id"]
        assert debt["remaining"] == 10000
        assert debt["status"] == "outstanding"

        # Partial payment
        p1 = requests.post(f"{API}/debts/{debt_id}/payments", headers=owner_headers,
                           json={"amount": 4000, "date": TODAY, "fund_source": "Cash"})
        assert p1.status_code == 200
        assert p1.json()["status"] == "parsial"
        assert p1.json()["remaining"] == 6000

        # Payment tx auto-created as expense with Bayar Hutang category
        pay_tx_id = p1.json()["payments"][0]["transaction_id"]
        tx = requests.get(f"{API}/transactions?category=Bayar Hutang", headers=owner_headers).json()
        assert any(t["id"] == pay_tx_id and t["type"] == "expense" for t in tx["transactions"])

        # Pay remaining
        p2 = requests.post(f"{API}/debts/{debt_id}/payments", headers=owner_headers,
                           json={"amount": 6000, "date": TODAY, "fund_source": "Cash"})
        assert p2.status_code == 200
        assert p2.json()["status"] == "lunas"

        # Overpay should fail
        p3 = requests.post(f"{API}/debts/{debt_id}/payments", headers=owner_headers,
                           json={"amount": 100, "date": TODAY, "fund_source": "Cash"})
        assert p3.status_code == 400

        # Delete a payment -> status reverts
        pay1_id = p1.json()["payments"][0]["id"]
        # Note: p1.json()["payments"] has 1 item; after p2 it has 2. Delete p2's payment
        payments = p2.json()["payments"]
        last_pay_id = payments[-1]["id"]
        d = requests.delete(f"{API}/debts/{debt_id}/payments/{last_pay_id}", headers=owner_headers)
        assert d.status_code == 200
        assert d.json()["status"] == "parsial"

        # Cleanup
        requests.delete(f"{API}/debts/{debt_id}", headers=owner_headers)

    def test_piutang_payment_is_income(self, owner_headers):
        r = requests.post(f"{API}/debts", headers=owner_headers,
                          json={"type": "piutang", "party": "TEST_Customer", "amount": 5000, "date": TODAY})
        debt_id = r.json()["id"]

        p = requests.post(f"{API}/debts/{debt_id}/payments", headers=owner_headers,
                          json={"amount": 2000, "date": TODAY, "fund_source": "BCA 1"})
        assert p.status_code == 200
        pay_tx_id = p.json()["payments"][0]["transaction_id"]
        tx_r = requests.get(f"{API}/transactions", headers=owner_headers).json()
        pay_tx = next((t for t in tx_r["transactions"] if t["id"] == pay_tx_id), None)
        assert pay_tx and pay_tx["type"] == "income"
        assert pay_tx["category"] == "Pembayaran Piutang"

        requests.delete(f"{API}/debts/{debt_id}", headers=owner_headers)


# ---------------- Reports ----------------
class TestReports:
    def test_summary(self, owner_headers):
        r = requests.get(f"{API}/reports/summary", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_income", "total_expense", "revenue", "non_revenue",
                  "hutang_outstanding", "piutang_outstanding", "draft_count"):
            assert k in d

    def test_pnl(self, owner_headers):
        r = requests.get(f"{API}/reports/pnl?month={MONTH}", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        assert "net_profit" in d and "expense_by_category" in d

    def test_cashflow(self, owner_headers):
        r = requests.get(f"{API}/reports/cashflow?months=6", headers=owner_headers)
        assert r.status_code == 200
        assert len(r.json()["months"]) == 6

    def test_audit_logs_owner(self, owner_headers):
        r = requests.get(f"{API}/audit-logs", headers=owner_headers)
        assert r.status_code == 200
        assert "logs" in r.json()


# ---------------- File upload ----------------
class TestFiles:
    def test_upload_and_serve(self, owner_headers):
        # 1x1 png
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108020000009077"
            "53DE0000000C4944415478DA6300010000000500010D0A2DB40000000049454E44AE426082")
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/files/upload", headers=owner_headers, files=files)
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        s = requests.get(f"{API}/files/{path}", headers=owner_headers)
        assert s.status_code == 200
