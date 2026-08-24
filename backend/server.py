from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query
from fastapi.responses import Response as RawResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
from pathlib import Path
import os
import logging
import uuid
import base64
import json
import re
import bcrypt
import jwt
import requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

OWNER_EMAIL = "andhry.adhriyanto@gmail.com"

FUND_SOURCES = ["Cash", "BCA 1", "BCA 2", "Mandiri", "BNI", "Other"]
REVENUE_CATEGORIES = ["Events", "Catering"]
NON_REVENUE_CATEGORIES = ["Pembayaran Piutang", "Other"]
INCOME_CATEGORIES = REVENUE_CATEGORIES + NON_REVENUE_CATEGORIES
EXPENSE_CATEGORIES = ["Buah", "Guest Supplies", "Cup", "Transportasi", "Sewa Tempat",
                      "Operational Event", "Marketing", "Printing", "Bayar Hutang", "Akomodasi", "Lainnya"]
NOTE_REQUIRED_CATEGORIES = {"Other", "Lainnya"}

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------- Object Storage ----------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
storage_key = None


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type},
                        data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type},
                            data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------- Auth ----------------
def public_user(u: dict) -> dict:
    return {"user_id": u["user_id"], "email": u["email"], "name": u.get("name"),
            "picture": u.get("picture"), "role": u["role"]}


async def resolve_user_from_token(token: str):
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return await db.users.find_one({"user_id": payload["user_id"]}, {"_id": 0})
    except Exception:
        pass
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if session:
        expires_at = session["expires_at"]
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return None
        return await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return None


async def get_current_user(request: Request):
    user = await resolve_user_from_token(request.cookies.get("session_token"))
    if not user:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            user = await resolve_user_from_token(auth[7:])
    if not user:
        user = await resolve_user_from_token(request.query_params.get("auth"))
    if not user:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    return user


async def require_owner(user=Depends(get_current_user)):
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Hanya owner yang dapat mengubah data")
    return user


class LoginInput(BaseModel):
    email: str
    password: str


class GoogleSessionInput(BaseModel):
    session_id: str


class UserCreate(BaseModel):
    email: str
    name: str
    password: str
    role: str = "team"


class RoleUpdate(BaseModel):
    role: str


@api_router.post("/auth/login")
async def login(input: LoginInput):
    user = await db.users.find_one({"email": input.email.lower().strip()}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    if not bcrypt.checkpw(input.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    token = jwt.encode(
        {"user_id": user["user_id"], "role": user["role"],
         "exp": datetime.now(timezone.utc) + timedelta(days=7)},
        JWT_SECRET, algorithm="HS256")
    return {"token": token, "user": public_user(user)}


@api_router.post("/auth/google-session")
async def google_session(input: GoogleSessionInput, response: Response):
    resp = requests.get(
        "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
        headers={"X-Session-ID": input.session_id}, timeout=15)
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Session Google tidak valid")
    data = resp.json()
    email = data["email"].lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        role = "owner" if email == OWNER_EMAIL else "team"
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email, "name": data.get("name"), "picture": data.get("picture"),
            "role": role, "password_hash": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
    session_token = data["session_token"]
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    await db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", path="/", max_age=7 * 24 * 3600)
    return public_user(user)


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_many({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api_router.get("/users")
async def list_users(user=Depends(require_owner)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    return {"users": users}


@api_router.post("/users")
async def create_user(input: UserCreate, user=Depends(require_owner)):
    email = input.email.lower().strip()
    if input.role not in ("owner", "team"):
        raise HTTPException(status_code=400, detail="Role tidak valid")
    if len(input.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    if not input.name.strip():
        raise HTTPException(status_code=400, detail="Nama wajib diisi")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email, "name": input.name.strip(), "picture": None,
        "role": input.role,
        "password_hash": bcrypt.hashpw(input.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await audit(user, "create", "user", doc["user_id"], f"{email} role={input.role}")
    return public_user(doc)


@api_router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, input: RoleUpdate, user=Depends(require_owner)):
    if input.role not in ("owner", "team"):
        raise HTTPException(status_code=400, detail="Role tidak valid")
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa mengubah role akun sendiri")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": input.role}})
    await audit(user, "update_role", "user", user_id, f"{target['email']} -> {input.role}")
    return public_user({**target, "role": input.role})


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_owner)):
    if user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    await audit(user, "delete", "user", user_id, target["email"])
    return {"ok": True}


# ---------------- Meta / Master data ----------------
@api_router.get("/meta")
async def get_meta(user=Depends(get_current_user)):
    return {
        "fund_sources": FUND_SOURCES,
        "income_groups": [
            {"group": "Revenue", "categories": REVENUE_CATEGORIES},
            {"group": "Non-revenue", "categories": NON_REVENUE_CATEGORIES},
        ],
        "expense_categories": EXPENSE_CATEGORIES,
    }


# ---------------- Audit ----------------
async def audit(user: dict, action: str, entity: str, entity_id: str, detail: str = ""):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"], "email": user["email"],
        "action": action, "entity": entity, "entity_id": entity_id, "detail": detail,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@api_router.get("/audit-logs")
async def get_audit_logs(user=Depends(require_owner)):
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"logs": logs}


# ---------------- Transactions ----------------
class TransactionCreate(BaseModel):
    type: str
    amount: float = 0
    date: str
    category: Optional[str] = None
    fund_source: Optional[str] = None
    to_fund_source: Optional[str] = None
    notes: Optional[str] = ""
    event_name: Optional[str] = None
    event_location: Optional[str] = None
    event_pic: Optional[str] = None
    attachment_path: Optional[str] = None
    status: str = "final"


def validate_tx(data: dict, for_final: bool):
    if data["type"] not in ("income", "expense", "transfer"):
        raise HTTPException(status_code=400, detail="Jenis transaksi tidak valid")
    if not for_final:
        return
    if data["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Nominal harus lebih dari 0")
    fs = data.get("fund_source")
    if fs not in FUND_SOURCES:
        raise HTTPException(status_code=400, detail="Sumber dana tidak valid")
    if data["type"] == "transfer":
        to_fs = data.get("to_fund_source")
        if to_fs not in FUND_SOURCES or to_fs == fs:
            raise HTTPException(status_code=400, detail="Sumber dana tujuan tidak valid")
    else:
        cat = data.get("category")
        valid = INCOME_CATEGORIES if data["type"] == "income" else EXPENSE_CATEGORIES
        if cat not in valid:
            raise HTTPException(status_code=400, detail="Kategori tidak valid")
        notes = (data.get("notes") or "").strip()
        if cat in NOTE_REQUIRED_CATEGORIES and not notes:
            raise HTTPException(status_code=400, detail=f"Kategori {cat} wajib mengisi catatan")
        if cat == "Events":
            if not (data.get("event_name") or "").strip():
                raise HTTPException(status_code=400, detail="Nama event wajib diisi")
            if not (data.get("event_location") or "").strip():
                raise HTTPException(status_code=400, detail="Lokasi event wajib diisi")
            if not (data.get("event_pic") or "").strip():
                raise HTTPException(status_code=400, detail="PIC event wajib diisi")


@api_router.get("/transactions")
async def list_transactions(type: str = None, status: str = None, fund_source: str = None,
                            category: str = None, month: str = None, limit: int = 300,
                            user=Depends(get_current_user)):
    q = {}
    if type:
        q["type"] = type
    if status:
        q["status"] = status
    if fund_source:
        q["$or"] = [{"fund_source": fund_source}, {"to_fund_source": fund_source}]
    if category:
        q["category"] = category
    if month:
        q["date"] = {"$regex": f"^{month}"}
    txs = await db.transactions.find(q, {"_id": 0}).sort(
        [("date", -1), ("created_at", -1)]).to_list(limit)
    return {"transactions": txs}


@api_router.post("/transactions")
async def create_transaction(input: TransactionCreate, user=Depends(require_owner)):
    data = input.model_dump()
    validate_tx(data, for_final=(data["status"] == "final"))
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), **data, "source": "manual", "ai_extraction": None,
           "debt_id": None, "debt_payment_id": None,
           "created_by": user["user_id"], "created_at": now, "updated_at": now}
    dup = False
    if data["status"] == "final":
        dup = await db.transactions.count_documents({
            "type": data["type"], "amount": data["amount"], "date": data["date"],
            "fund_source": data.get("fund_source"), "status": "final"}) > 0
    await db.transactions.insert_one(doc)
    await audit(user, "create", "transaction", doc["id"],
                f"{data['type']} {data['amount']}")
    doc.pop("_id", None)
    return {"transaction": doc, "duplicate_warning": dup}


@api_router.put("/transactions/{tx_id}")
async def update_transaction(tx_id: str, input: TransactionCreate, user=Depends(require_owner)):
    existing = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if existing.get("debt_payment_id"):
        raise HTTPException(status_code=400,
                            detail="Transaksi pembayaran hutang/piutang hanya bisa diubah dari modul Hutang & Piutang")
    data = input.model_dump()
    validate_tx(data, for_final=(data["status"] == "final"))
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.transactions.update_one({"id": tx_id}, {"$set": data})
    await audit(user, "update", "transaction", tx_id,
                f"{data['type']} {data['amount']} status={data['status']}")
    updated = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    return {"transaction": updated}


@api_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, user=Depends(require_owner)):
    existing = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if existing.get("debt_payment_id"):
        raise HTTPException(status_code=400,
                            detail="Hapus pembayaran dari modul Hutang & Piutang")
    await db.transactions.delete_one({"id": tx_id})
    await audit(user, "delete", "transaction", tx_id,
                f"{existing['type']} {existing['amount']}")
    return {"ok": True}


# ---------------- Balances ----------------
@api_router.get("/balances")
async def get_balances(user=Depends(get_current_user)):
    result = {fs: 0.0 for fs in FUND_SOURCES}
    cursor = db.transactions.find({"status": "final"},
                                  {"_id": 0, "type": 1, "amount": 1, "fund_source": 1, "to_fund_source": 1})
    async for t in cursor:
        if t["type"] == "income":
            result[t["fund_source"]] = result.get(t["fund_source"], 0) + t["amount"]
        elif t["type"] == "expense":
            result[t["fund_source"]] = result.get(t["fund_source"], 0) - t["amount"]
        elif t["type"] == "transfer":
            result[t["fund_source"]] = result.get(t["fund_source"], 0) - t["amount"]
            result[t["to_fund_source"]] = result.get(t["to_fund_source"], 0) + t["amount"]
    return {"balances": [{"name": k, "balance": v} for k, v in result.items()],
            "total": sum(result.values())}


# ---------------- Events ----------------
@api_router.get("/events")
async def list_events(user=Depends(get_current_user)):
    txs = await db.transactions.find({"category": "Events", "status": "final"},
                                     {"_id": 0}).sort("date", -1).to_list(500)
    return {"events": txs, "total": sum(t["amount"] for t in txs)}


# ---------------- Debts (Hutang & Piutang) ----------------
class DebtCreate(BaseModel):
    type: str
    party: str
    amount: float
    date: str
    due_date: Optional[str] = None
    notes: Optional[str] = ""


class PaymentCreate(BaseModel):
    amount: float
    date: str
    fund_source: str
    notes: Optional[str] = ""


def debt_out(d: dict) -> dict:
    paid = sum(p["amount"] for p in d.get("payments", []))
    d["paid"] = paid
    d["remaining"] = d["amount"] - paid
    d.pop("_id", None)
    return d


@api_router.get("/debts")
async def list_debts(type: str = None, user=Depends(get_current_user)):
    q = {"type": type} if type else {}
    debts = await db.debts.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return {"debts": [debt_out(d) for d in debts]}


@api_router.post("/debts")
async def create_debt(input: DebtCreate, user=Depends(require_owner)):
    if input.type not in ("hutang", "piutang"):
        raise HTTPException(status_code=400, detail="Tipe harus hutang atau piutang")
    if input.amount <= 0:
        raise HTTPException(status_code=400, detail="Nominal harus lebih dari 0")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), **input.model_dump(), "payments": [],
           "status": "outstanding", "created_by": user["user_id"], "created_at": now}
    await db.debts.insert_one(doc)
    await audit(user, "create", "debt", doc["id"], f"{input.type} {input.party} {input.amount}")
    doc.pop("_id", None)
    return debt_out(doc)


@api_router.post("/debts/{debt_id}/payments")
async def add_payment(debt_id: str, input: PaymentCreate, user=Depends(require_owner)):
    debt = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    if not debt:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")
    if input.fund_source not in FUND_SOURCES:
        raise HTTPException(status_code=400, detail="Sumber dana tidak valid")
    paid = sum(p["amount"] for p in debt.get("payments", []))
    remaining = debt["amount"] - paid
    if input.amount <= 0 or input.amount > remaining:
        raise HTTPException(status_code=400,
                            detail=f"Nominal pembayaran harus antara 0 dan sisa ({remaining})")
    now = datetime.now(timezone.utc).isoformat()
    payment_id = str(uuid.uuid4())
    is_hutang = debt["type"] == "hutang"
    tx = {
        "id": str(uuid.uuid4()),
        "type": "expense" if is_hutang else "income",
        "amount": input.amount, "date": input.date,
        "category": "Bayar Hutang" if is_hutang else "Pembayaran Piutang",
        "fund_source": input.fund_source, "to_fund_source": None,
        "notes": input.notes or f"Pembayaran {debt['type']} - {debt['party']}",
        "event_name": None, "event_location": None, "event_pic": None,
        "attachment_path": None, "status": "final", "source": "debt",
        "ai_extraction": None, "debt_id": debt_id, "debt_payment_id": payment_id,
        "created_by": user["user_id"], "created_at": now, "updated_at": now,
    }
    await db.transactions.insert_one(tx)
    payment = {"id": payment_id, "amount": input.amount, "date": input.date,
               "fund_source": input.fund_source, "notes": input.notes,
               "transaction_id": tx["id"], "created_by": user["user_id"], "created_at": now}
    new_paid = paid + input.amount
    status = "lunas" if new_paid >= debt["amount"] else "parsial"
    await db.debts.update_one({"id": debt_id},
                              {"$push": {"payments": payment}, "$set": {"status": status}})
    await audit(user, "payment", "debt", debt_id,
                f"{debt['type']} {debt['party']} bayar {input.amount}")
    updated = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    return debt_out(updated)


@api_router.delete("/debts/{debt_id}/payments/{payment_id}")
async def delete_payment(debt_id: str, payment_id: str, user=Depends(require_owner)):
    debt = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    if not debt:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")
    payment = next((p for p in debt.get("payments", []) if p["id"] == payment_id), None)
    if not payment:
        raise HTTPException(status_code=404, detail="Pembayaran tidak ditemukan")
    await db.transactions.delete_one({"id": payment["transaction_id"]})
    await db.debts.update_one({"id": debt_id}, {"$pull": {"payments": {"id": payment_id}}})
    updated = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    paid = sum(p["amount"] for p in updated.get("payments", []))
    status = "lunas" if paid >= updated["amount"] else ("parsial" if paid > 0 else "outstanding")
    await db.debts.update_one({"id": debt_id}, {"$set": {"status": status}})
    await audit(user, "delete_payment", "debt", debt_id, f"hapus pembayaran {payment['amount']}")
    updated = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    return debt_out(updated)


@api_router.delete("/debts/{debt_id}")
async def delete_debt(debt_id: str, user=Depends(require_owner)):
    debt = await db.debts.find_one({"id": debt_id}, {"_id": 0})
    if not debt:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")
    for p in debt.get("payments", []):
        await db.transactions.delete_one({"id": p["transaction_id"]})
    await db.debts.delete_one({"id": debt_id})
    await audit(user, "delete", "debt", debt_id, f"{debt['type']} {debt['party']}")
    return {"ok": True}


# ---------------- Files ----------------
@api_router.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(require_owner)):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran file maksimal 10MB")
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "bin"
    path = f"sariwarasa/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    content_type = file.content_type or "application/octet-stream"
    result = put_object(path, data, content_type)
    await db.files.insert_one({
        "id": str(uuid.uuid4()), "storage_path": result["path"],
        "original_filename": file.filename, "content_type": content_type,
        "size": result["size"], "is_deleted": False,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"], "filename": file.filename,
            "content_type": content_type, "size": result["size"]}


@api_router.get("/files/{path:path}")
async def serve_file(path: str, user=Depends(get_current_user)):
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="File tidak ditemukan")
    data, ct = get_object(path)
    return RawResponse(content=data, media_type=rec.get("content_type") or ct)


# ---------------- AI Extraction ----------------
AI_PROMPT = """Anda adalah asisten ekstraksi data keuangan untuk bisnis FnB "Sariwarasa".
Analisis gambar ini (bisa nota/struk belanja, screenshot mutasi bank, invoice/tagihan, tulisan tangan, atau foto buku catatan).
Ekstrak dan kembalikan HANYA JSON valid tanpa markdown, tanpa penjelasan:
{
 "document_type": "nota|mutasi_bank|invoice|tulisan_tangan|lainnya",
 "type": "income|expense|unknown",
 "amount": <angka total dalam Rupiah tanpa titik/koma, atau 0 jika tidak jelas>,
 "date": "YYYY-MM-DD atau null",
 "description": "ringkasan singkat transaksi dalam Bahasa Indonesia",
 "suggested_category": "<satu kategori dari daftar di bawah, atau null>",
 "suggested_fund_source": "<Cash|BCA 1|BCA 2|Mandiri|BNI|Other, atau null>",
 "confidence": "high|medium|low",
 "warnings": ["hal yang ambigu atau perlu dicek user"]
}
Kategori pemasukan: Events, Catering, Pembayaran Piutang, Other.
Kategori pengeluaran: Buah, Guest Supplies, Cup, Transportasi, Sewa Tempat, Operational Event, Marketing, Printing, Bayar Hutang, Akomodasi, Lainnya.
Aturan: struk belanja/tagihan keluar -> expense. Uang masuk/transfer masuk -> income. Jika ambigu, type="unknown" dan jelaskan di warnings. Untuk mutasi bank, pilih transaksi yang paling jelas."""


@api_router.post("/ai/extract")
async def ai_extract(file: UploadFile = File(...), user=Depends(require_owner)):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=400, detail="Format gambar harus JPEG, PNG, atau WEBP")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran gambar maksimal 10MB")

    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
    path = f"sariwarasa/ai/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    result = put_object(path, data, file.content_type)
    await db.files.insert_one({
        "id": str(uuid.uuid4()), "storage_path": result["path"],
        "original_filename": file.filename, "content_type": file.content_type,
        "size": result["size"], "is_deleted": False,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"extract-{uuid.uuid4().hex[:8]}",
        system_message="Anda adalah mesin ekstraksi data keuangan. Selalu jawab dengan JSON valid saja.",
    ).with_model("openai", "gpt-5.6-terra")
    image_content = ImageContent(image_base64=base64.b64encode(data).decode())
    response_text = await chat.send_message(
        UserMessage(text=AI_PROMPT, file_contents=[image_content]))

    text = response_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        extraction = json.loads(text)
    except Exception:
        raise HTTPException(status_code=422, detail="AI tidak menghasilkan data valid, coba gambar lain")

    tx_type = extraction.get("type") if extraction.get("type") in ("income", "expense") else "unknown"
    cat = extraction.get("suggested_category")
    if cat not in INCOME_CATEGORIES + EXPENSE_CATEGORIES:
        cat = None
    fs = extraction.get("suggested_fund_source")
    if fs not in FUND_SOURCES:
        fs = None
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "type": tx_type,
        "amount": float(extraction.get("amount") or 0),
        "date": extraction.get("date") or now[:10],
        "category": cat, "fund_source": fs, "to_fund_source": None,
        "notes": extraction.get("description") or "",
        "event_name": None, "event_location": None, "event_pic": None,
        "attachment_path": result["path"], "status": "draft", "source": "ai",
        "ai_extraction": extraction, "debt_id": None, "debt_payment_id": None,
        "created_by": user["user_id"], "created_at": now, "updated_at": now,
    }
    await db.transactions.insert_one(doc)
    await audit(user, "ai_extract", "transaction", doc["id"],
                f"draft dari {file.filename}")
    doc.pop("_id", None)
    return {"draft": doc, "extraction": extraction}


# ---------------- Reports ----------------
@api_router.get("/reports/summary")
async def report_summary(user=Depends(get_current_user)):
    income_total = expense_total = revenue_total = non_revenue_total = 0.0
    cursor = db.transactions.find({"status": "final", "type": {"$in": ["income", "expense"]}},
                                  {"_id": 0, "type": 1, "amount": 1, "category": 1})
    async for t in cursor:
        if t["type"] == "income":
            income_total += t["amount"]
            if t.get("category") in REVENUE_CATEGORIES:
                revenue_total += t["amount"]
            else:
                non_revenue_total += t["amount"]
        else:
            expense_total += t["amount"]
    hutang_out = piutang_out = 0.0
    async for d in db.debts.find({}, {"_id": 0, "type": 1, "amount": 1, "payments": 1}):
        remaining = d["amount"] - sum(p["amount"] for p in d.get("payments", []))
        if d["type"] == "hutang":
            hutang_out += remaining
        else:
            piutang_out += remaining
    draft_count = await db.transactions.count_documents({"status": "draft"})
    return {
        "total_income": income_total, "total_expense": expense_total,
        "revenue": revenue_total, "non_revenue": non_revenue_total,
        "hutang_outstanding": hutang_out, "piutang_outstanding": piutang_out,
        "draft_count": draft_count,
    }


@api_router.get("/reports/cashflow")
async def report_cashflow(months: int = 6, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    keys = []
    y, m = now.year, now.month
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    keys.reverse()
    series = {k: {"month": k, "income": 0.0, "expense": 0.0} for k in keys}
    cursor = db.transactions.find(
        {"status": "final", "type": {"$in": ["income", "expense"]}, "date": {"$gte": keys[0] + "-01"}},
        {"_id": 0, "type": 1, "amount": 1, "date": 1})
    async for t in cursor:
        key = t["date"][:7]
        if key in series:
            series[key][t["type"]] += t["amount"]
    return {"months": list(series.values())}


@api_router.get("/reports/pnl")
async def report_pnl(month: str = None, user=Depends(get_current_user)):
    q = {"status": "final", "type": {"$in": ["income", "expense"]}}
    if month:
        q["date"] = {"$regex": f"^{month}"}
    revenue = non_revenue = total_expense = 0.0
    by_category = {}
    cursor = db.transactions.find(q, {"_id": 0, "type": 1, "amount": 1, "category": 1})
    async for t in cursor:
        if t["type"] == "income":
            if t.get("category") in REVENUE_CATEGORIES:
                revenue += t["amount"]
            else:
                non_revenue += t["amount"]
        else:
            total_expense += t["amount"]
            by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]
    return {
        "month": month, "revenue": revenue, "non_revenue": non_revenue,
        "total_expense": total_expense,
        "expense_by_category": [{"category": k, "total": v} for k, v in
                                sorted(by_category.items(), key=lambda x: -x[1])],
        "net_profit": revenue - total_expense,
    }


# ---------------- Startup ----------------
@app.on_event("startup")
async def startup():
    seeds = [
        (OWNER_EMAIL, "Andhry (Owner)", "owner"),
        ("team@sariwarasa.com", "Team Sariwarasa", "team"),
    ]
    for email, name, role in seeds:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if not existing:
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}",
                "email": email, "name": name, "picture": None, "role": role,
                "password_hash": bcrypt.hashpw("sariwarasa123".encode(), bcrypt.gensalt()).decode(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info(f"Seeded user {email} ({role})")
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
