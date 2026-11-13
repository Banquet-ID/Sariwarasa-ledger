from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query
from fastapi.responses import Response as RawResponse, StreamingResponse
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
import json
import re
import bcrypt
import jwt
import io
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']

OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "andhry.adhriyanto@gmail.com")

# ============================================================
# MASTER DATA DEFINITIONS (seeds for DB collections)
# ============================================================
FUND_SOURCES = ["Cash", "BCA 1", "BCA 2", "Mandiri", "BNI", "Other"]

REVENUE_CATEGORIES = ["Events", "Catering"]
NON_REVENUE_CATEGORIES = ["Pembayaran Piutang", "Hutang", "Other"]
INCOME_CATEGORIES = REVENUE_CATEGORIES + NON_REVENUE_CATEGORIES

# Default income category groups for seeding
DEFAULT_INCOME_GROUPS = [
    {"group": "Revenue", "categories": REVENUE_CATEGORIES},
    {"group": "Non-revenue", "categories": NON_REVENUE_CATEGORIES},
]

# Default expense categories (seeded once to DB, then managed in Settings)
DEFAULT_EXPENSE_CATEGORIES = ["Buah", "Guest Supplies", "Cup", "Transportasi", "Sewa Tempat",
                              "Operational Event", "Marketing", "Printing", "Bayar Hutang", "Piutang", "Akomodasi", "Lainnya"]

# Protected categories that cannot be renamed/deleted (system logic depends on them)
PROTECTED_EXPENSE_CATEGORIES = {"Bayar Hutang", "Piutang", "Lainnya"}
PROTECTED_INCOME_CATEGORIES = {"Pembayaran Piutang", "Hutang", "Other"}
NOTE_REQUIRED_CATEGORIES = {"Other", "Lainnya"}

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------- Storage & AI providers ----------------
from storage import put_object, get_object, storage_configured
from ai_provider import extract_receipt


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


class GoogleTokenInput(BaseModel):
    credential: str


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


@api_router.post("/auth/google")
async def google_login(input: GoogleTokenInput):
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=503, detail="Login Google belum dikonfigurasi (GOOGLE_CLIENT_ID)")
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests
    try:
        info = google_id_token.verify_oauth2_token(input.credential, google_requests.Request(), client_id)
    except Exception:
        raise HTTPException(status_code=401, detail="Token Google tidak valid")
    email = info["email"].lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        role = "owner" if email == OWNER_EMAIL else "team"
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email, "name": info.get("name"), "picture": info.get("picture"),
            "role": role, "password_hash": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
    token = jwt.encode(
        {"user_id": user["user_id"], "role": user["role"],
         "exp": datetime.now(timezone.utc) + timedelta(days=7)},
        JWT_SECRET, algorithm="HS256")
    return {"token": token, "user": public_user(user)}


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


# ---------------- Audit ----------------
async def audit(user: dict, action: str, entity: str, entity_id: str, detail: str = ""):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"], "email": user["email"],
        "action": action, "entity": entity, "entity_id": entity_id, "detail": detail,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ---------------- Expense Categories (dynamic, manageable in Settings) ----------------
class ExpenseCategoryInput(BaseModel):
    name: str


async def ensure_expense_categories():
    """Seed default expense categories once if collection is empty."""
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.expense_categories.find({}, {"_id": 0, "name": 1}).to_list(500)
    names = {d["name"] for d in existing}
    missing = [name for name in DEFAULT_EXPENSE_CATEGORIES if name not in names]
    if missing:
        last = await db.expense_categories.find({}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
        start = (last[0]["order"] + 1) if last else 0
        await db.expense_categories.insert_many([
            {"id": str(uuid.uuid4()), "name": name, "order": start + i, "created_at": now}
            for i, name in enumerate(missing)
        ])


async def get_expense_category_names() -> list:
    await ensure_expense_categories()
    docs = await db.expense_categories.find({}, {"_id": 0, "name": 1}).sort("order", 1).to_list(500)
    return [d["name"] for d in docs]


def clean_category_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nama kategori wajib diisi")
    if len(name) > 50:
        raise HTTPException(status_code=400, detail="Nama kategori maksimal 50 karakter")
    return name


async def find_category_by_name(name: str, exclude_id: str = None):
    q = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return await db.expense_categories.find_one(q, {"_id": 0})


def category_out(c: dict, used: int = 0) -> dict:
    return {"id": c["id"], "name": c["name"], "order": c.get("order", 0),
            "protected": c["name"] in PROTECTED_EXPENSE_CATEGORIES, "usage_count": used}


@api_router.get("/expense-categories")
async def list_expense_categories(user=Depends(get_current_user)):
    await ensure_expense_categories()
    docs = await db.expense_categories.find({}, {"_id": 0}).sort("order", 1).to_list(500)
    counts = {}
    async for row in db.transactions.aggregate([
        {"$match": {"type": "expense", "category": {"$ne": None}}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    return {"categories": [category_out(c, counts.get(c["name"], 0)) for c in docs]}


@api_router.post("/expense-categories")
async def create_expense_category(input: ExpenseCategoryInput, user=Depends(require_owner)):
    await ensure_expense_categories()
    name = clean_category_name(input.name)
    if await find_category_by_name(name):
        raise HTTPException(status_code=400, detail=f"Kategori \"{name}\" sudah ada")
    last = await db.expense_categories.find({}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
    doc = {"id": str(uuid.uuid4()), "name": name,
           "order": (last[0]["order"] + 1) if last else 0,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.expense_categories.insert_one(doc)
    await audit(user, "create", "expense_category", doc["id"], name)
    return category_out(doc)


@api_router.put("/expense-categories/{category_id}")
async def update_expense_category(category_id: str, input: ExpenseCategoryInput,
                                  user=Depends(require_owner)):
    existing = await db.expense_categories.find_one({"id": category_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if existing["name"] in PROTECTED_EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"Kategori \"{existing['name']}\" dipakai sistem dan tidak bisa diubah")
    name = clean_category_name(input.name)
    if await find_category_by_name(name, exclude_id=category_id):
        raise HTTPException(status_code=400, detail=f"Kategori \"{name}\" sudah ada")
    if name != existing["name"]:
        await db.expense_categories.update_one({"id": category_id}, {"$set": {"name": name}})
        await db.transactions.update_many({"type": "expense", "category": existing["name"]},
                                          {"$set": {"category": name}})
        await audit(user, "update", "expense_category", category_id, f"{existing['name']} -> {name}")
    return category_out({**existing, "name": name})


@api_router.delete("/expense-categories/{category_id}")
async def delete_expense_category(category_id: str, user=Depends(require_owner)):
    existing = await db.expense_categories.find_one({"id": category_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if existing["name"] in PROTECTED_EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"Kategori \"{existing['name']}\" dipakai sistem dan tidak bisa dihapus")
    used = await db.transactions.count_documents({"type": "expense", "category": existing["name"]})
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Kategori \"{existing['name']}\" masih dipakai {used} transaksi. "
                   "Ubah kategori transaksi tersebut atau ganti nama kategori ini saja.")
    await db.expense_categories.delete_one({"id": category_id})
    await audit(user, "delete", "expense_category", category_id, existing["name"])
    return {"ok": True}


# ---------------- Income Categories (dynamic, grouped) ----------------
class IncomeCategoryInput(BaseModel):
    name: str
    group: str  # "Revenue" or "Non-revenue"


async def ensure_income_categories():
    """Seed default income categories once if collection is empty."""
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.income_categories.find({}, {"_id": 0, "name": 1}).to_list(500)
    names = {d["name"] for d in existing}
    docs = []
    for group in DEFAULT_INCOME_GROUPS:
        current = await db.income_categories.find({"group": group["group"]}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
        start = (current[0]["order"] + 1) if current else 0
        for name in group["categories"]:
            if name not in names:
                docs.append({"id": str(uuid.uuid4()), "name": name, "group": group["group"],
                             "order": start + len([d for d in docs if d["group"] == group["group"]]),
                             "created_at": now})
    if docs:
        await db.income_categories.insert_many(docs)


async def get_income_category_names() -> list:
    await ensure_income_categories()
    docs = await db.income_categories.find({}, {"_id": 0, "name": 1}).sort([("group", 1), ("order", 1)]).to_list(500)
    return [d["name"] for d in docs]


async def get_income_groups() -> list:
    await ensure_income_categories()
    docs = await db.income_categories.find({}, {"_id": 0}).sort([("group", 1), ("order", 1)]).to_list(500)
    grouped = {}
    for d in docs:
        g = d.get("group", "Revenue")
        if g not in grouped:
            grouped[g] = {"group": g, "categories": []}
        grouped[g]["categories"].append(d["name"])
    return list(grouped.values())


async def find_income_category_by_name(name: str, exclude_id: str = None):
    q = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return await db.income_categories.find_one(q, {"_id": 0})


def income_category_out(c: dict, used: int = 0) -> dict:
    return {"id": c["id"], "name": c["name"], "group": c.get("group", "Revenue"),
            "order": c.get("order", 0),
            "protected": c["name"] in PROTECTED_INCOME_CATEGORIES, "usage_count": used}


@api_router.get("/income-categories")
async def list_income_categories(user=Depends(get_current_user)):
    await ensure_income_categories()
    docs = await db.income_categories.find({}, {"_id": 0}).sort([("group", 1), ("order", 1)]).to_list(500)
    counts = {}
    async for row in db.transactions.aggregate([
        {"$match": {"type": "income", "category": {"$ne": None}}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    return {"categories": [income_category_out(c, counts.get(c["name"], 0)) for c in docs]}


@api_router.post("/income-categories")
async def create_income_category(input: IncomeCategoryInput, user=Depends(require_owner)):
    await ensure_income_categories()
    name = clean_category_name(input.name)
    if input.group not in ("Revenue", "Non-revenue"):
        raise HTTPException(status_code=400, detail="Group harus 'Revenue' atau 'Non-revenue'")
    if await find_income_category_by_name(name):
        raise HTTPException(status_code=400, detail=f"Kategori \"{name}\" sudah ada")
    last = await db.income_categories.find({"group": input.group}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
    doc = {"id": str(uuid.uuid4()), "name": name, "group": input.group,
           "order": (last[0]["order"] + 1) if last else 0,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.income_categories.insert_one(doc)
    await audit(user, "create", "income_category", doc["id"], f"{name} ({input.group})")
    return income_category_out(doc)


@api_router.put("/income-categories/{category_id}")
async def update_income_category(category_id: str, input: IncomeCategoryInput,
                                 user=Depends(require_owner)):
    existing = await db.income_categories.find_one({"id": category_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if existing["name"] in PROTECTED_INCOME_CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"Kategori \"{existing['name']}\" dipakai sistem dan tidak bisa diubah")
    if input.group not in ("Revenue", "Non-revenue"):
        raise HTTPException(status_code=400, detail="Group harus 'Revenue' atau 'Non-revenue'")
    name = clean_category_name(input.name)
    if await find_income_category_by_name(name, exclude_id=category_id):
        raise HTTPException(status_code=400, detail=f"Kategori \"{name}\" sudah ada")
    if name != existing["name"] or input.group != existing.get("group", "Revenue"):
        await db.income_categories.update_one({"id": category_id}, {"$set": {"name": name, "group": input.group}})
        await db.transactions.update_many({"type": "income", "category": existing["name"]},
                                          {"$set": {"category": name}})
        await audit(user, "update", "income_category", category_id, f"{existing['name']} -> {name}")
    return income_category_out({**existing, "name": name, "group": input.group})


@api_router.delete("/income-categories/{category_id}")
async def delete_income_category(category_id: str, user=Depends(require_owner)):
    existing = await db.income_categories.find_one({"id": category_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if existing["name"] in PROTECTED_INCOME_CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"Kategori \"{existing['name']}\" dipakai sistem dan tidak bisa dihapus")
    used = await db.transactions.count_documents({"type": "income", "category": existing["name"]})
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Kategori \"{existing['name']}\" masih dipakai {used} transaksi. "
                   "Ubah kategori transaksi tersebut atau ganti nama kategori ini saja.")
    await db.income_categories.delete_one({"id": category_id})
    await audit(user, "delete", "income_category", category_id, existing["name"])
    return {"ok": True}


# ---------------- Fund Sources / Bank (dynamic, manageable in Settings) ----------------
class FundSourceInput(BaseModel):
    name: str


async def ensure_fund_sources():
    """Seed default fund sources once if collection is empty."""
    if await db.fund_sources.count_documents({}) > 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.fund_sources.insert_many([
        {"id": str(uuid.uuid4()), "name": name, "order": i, "created_at": now}
        for i, name in enumerate(FUND_SOURCES)
    ])


async def get_fund_source_names() -> list:
    await ensure_fund_sources()
    docs = await db.fund_sources.find({}, {"_id": 0, "name": 1}).sort("order", 1).to_list(500)
    return [d["name"] for d in docs]


async def find_fund_source_by_name(name: str, exclude_id: str = None):
    q = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return await db.fund_sources.find_one(q, {"_id": 0})


def fund_source_out(fs: dict, used: int = 0) -> dict:
    return {"id": fs["id"], "name": fs["name"], "order": fs.get("order", 0), "usage_count": used}


@api_router.get("/fund-sources")
async def list_fund_sources(user=Depends(get_current_user)):
    await ensure_fund_sources()
    docs = await db.fund_sources.find({}, {"_id": 0}).sort("order", 1).to_list(500)
    counts = {}
    async for row in db.transactions.aggregate([
        {"$match": {"fund_source": {"$ne": None}, "status": "final"}},
        {"$group": {"_id": "$fund_source", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    # Also count as to_fund_source for transfers
    async for row in db.transactions.aggregate([
        {"$match": {"to_fund_source": {"$ne": None}, "status": "final"}},
        {"$group": {"_id": "$to_fund_source", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = counts.get(row["_id"], 0) + row["n"]
    return {"fund_sources": [fund_source_out(fs, counts.get(fs["name"], 0)) for fs in docs]}


@api_router.post("/fund-sources")
async def create_fund_source(input: FundSourceInput, user=Depends(require_owner)):
    await ensure_fund_sources()
    name = clean_category_name(input.name)
    if await find_fund_source_by_name(name):
        raise HTTPException(status_code=400, detail=f"Sumber dana \"{name}\" sudah ada")
    last = await db.fund_sources.find({}, {"_id": 0, "order": 1}).sort("order", -1).to_list(1)
    doc = {"id": str(uuid.uuid4()), "name": name,
           "order": (last[0]["order"] + 1) if last else 0,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.fund_sources.insert_one(doc)
    await audit(user, "create", "fund_source", doc["id"], name)
    return fund_source_out(doc)


@api_router.put("/fund-sources/{fs_id}")
async def update_fund_source(fs_id: str, input: FundSourceInput, user=Depends(require_owner)):
    existing = await db.fund_sources.find_one({"id": fs_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Sumber dana tidak ditemukan")
    name = clean_category_name(input.name)
    if await find_fund_source_by_name(name, exclude_id=fs_id):
        raise HTTPException(status_code=400, detail=f"Sumber dana \"{name}\" sudah ada")
    if name != existing["name"]:
        await db.fund_sources.update_one({"id": fs_id}, {"$set": {"name": name}})
        # Update transactions that reference this fund source
        await db.transactions.update_many({"fund_source": existing["name"]}, {"$set": {"fund_source": name}})
        await db.transactions.update_many({"to_fund_source": existing["name"]}, {"$set": {"to_fund_source": name}})
        # Riwayat pembayaran hutang/piutang menyimpan nama sumber dana di dalam dokumen debts.
        await db.debts.update_many(
            {"payments.fund_source": existing["name"]},
            {"$set": {"payments.$[p].fund_source": name}},
            array_filters=[{"p.fund_source": existing["name"]}])
        await audit(user, "update", "fund_source", fs_id, f"{existing['name']} -> {name}")
    return fund_source_out({**existing, "name": name})


@api_router.delete("/fund-sources/{fs_id}")
async def delete_fund_source(fs_id: str, user=Depends(require_owner)):
    existing = await db.fund_sources.find_one({"id": fs_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Sumber dana tidak ditemukan")
    used = await db.transactions.count_documents({
        "$or": [{"fund_source": existing["name"]}, {"to_fund_source": existing["name"]}],
        "status": "final"
    })
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Sumber dana \"{existing['name']}\" masih dipakai {used} transaksi. "
                   "Ubah sumber dana transaksi tersebut terlebih dahulu.")
    await db.fund_sources.delete_one({"id": fs_id})
    await audit(user, "delete", "fund_source", fs_id, existing["name"])
    return {"ok": True}


# ---------------- Meta / Master data (for dropdowns in UI) ----------------
@api_router.get("/meta")
async def get_meta(user=Depends(get_current_user)):
    return {
        "fund_sources": await get_fund_source_names(),
        "income_groups": await get_income_groups(),
        "expense_categories": await get_expense_category_names(),
    }


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
    party: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "final"


async def validate_tx(data: dict, for_final: bool):
    if data["type"] not in ("income", "expense", "transfer"):
        raise HTTPException(status_code=400, detail="Jenis transaksi tidak valid")
    if not for_final:
        return
    if data["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Nominal harus lebih dari 0")
    fs = data.get("fund_source")
    if fs not in await get_fund_source_names():
        raise HTTPException(status_code=400, detail="Sumber dana tidak valid")
    if data["type"] == "transfer":
        to_fs = data.get("to_fund_source")
        if to_fs not in await get_fund_source_names() or to_fs == fs:
            raise HTTPException(status_code=400, detail="Sumber dana tujuan tidak valid")
    else:
        if data["type"] == "income":
            valid = await get_income_category_names()
        else:
            valid = await get_expense_category_names()
        cat = data.get("category")
        if cat not in valid:
            raise HTTPException(status_code=400, detail="Kategori tidak valid")
        notes = (data.get("notes") or "").strip()
        if cat in NOTE_REQUIRED_CATEGORIES and not notes:
            raise HTTPException(status_code=400, detail=f"Kategori {cat} wajib mengisi catatan")
        if cat in ("Piutang", "Hutang"):
            if not (data.get("party") or "").strip():
                raise HTTPException(status_code=400, detail="Nama pihak terkait wajib diisi")
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
    await validate_tx(data, for_final=(data["status"] == "final"))
    now = datetime.now(timezone.utc).isoformat()
    debt_id = None
    is_debt_origin = data["status"] == "final" and (
        (data["type"] == "expense" and data.get("category") == "Piutang") or
        (data["type"] == "income" and data.get("category") == "Hutang"))
    if is_debt_origin:
        debt_id = str(uuid.uuid4())
        debt_type = "piutang" if data["category"] == "Piutang" else "hutang"
        debt = {"id": debt_id, "type": debt_type, "party": data["party"].strip(),
                "amount": data["amount"], "date": data["date"], "due_date": data.get("due_date"),
                "notes": data.get("notes") or "", "payments": [], "status": "outstanding",
                "origin_transaction_id": None, "created_by": user["user_id"], "created_at": now}
    doc = {"id": str(uuid.uuid4()), **data, "source": "manual", "ai_extraction": None,
           "debt_id": debt_id, "debt_payment_id": None,
           "created_by": user["user_id"], "created_at": now, "updated_at": now}
    if is_debt_origin:
        debt["origin_transaction_id"] = doc["id"]
    dup = False
    if data["status"] == "final":
        dup = await db.transactions.count_documents({
            "type": data["type"], "amount": data["amount"], "date": data["date"],
            "fund_source": data.get("fund_source"), "status": "final"}) > 0
    await db.transactions.insert_one(doc)
    if is_debt_origin:
        await db.debts.insert_one(debt)
        await audit(user, "create", "debt", debt_id, f"{debt_type} {debt['party']} {debt['amount']}")
    await audit(user, "create", "transaction", doc["id"], f"{data['type']} {data['amount']}")
    doc.pop("_id", None)
    return {"transaction": doc, "duplicate_warning": dup}


@api_router.put("/transactions/{tx_id}")
async def update_transaction(tx_id: str, input: TransactionCreate, user=Depends(require_owner)):
    existing = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if existing.get("debt_payment_id") or existing.get("debt_id"):
        raise HTTPException(status_code=400,
                            detail="Transaksi terkait hutang/piutang hanya bisa dikelola dari modul Hutang & Piutang")
    data = input.model_dump()
    await validate_tx(data, for_final=(data["status"] == "final"))
    now = datetime.now(timezone.utc).isoformat()
    is_debt_origin = data["status"] == "final" and (
        (data["type"] == "expense" and data.get("category") == "Piutang") or
        (data["type"] == "income" and data.get("category") == "Hutang"))
    if is_debt_origin:
        debt_id = str(uuid.uuid4())
        debt_type = "piutang" if data["category"] == "Piutang" else "hutang"
        debt = {"id": debt_id, "type": debt_type, "party": data["party"].strip(),
                "amount": data["amount"], "date": data["date"], "due_date": data.get("due_date"),
                "notes": data.get("notes") or "", "payments": [], "status": "outstanding",
                "origin_transaction_id": tx_id, "created_by": user["user_id"], "created_at": now}
        await db.debts.insert_one(debt)
        data["debt_id"] = debt_id
        await audit(user, "create", "debt", debt_id, f"{debt_type} {debt['party']} {debt['amount']}")
    data["updated_at"] = now
    await db.transactions.update_one({"id": tx_id}, {"$set": data})
    await audit(user, "update", "transaction", tx_id, f"{data['type']} {data['amount']} status={data['status']}")
    updated = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    return {"transaction": updated}


@api_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, user=Depends(require_owner)):
    existing = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if existing.get("debt_payment_id") or existing.get("debt_id"):
        raise HTTPException(status_code=400, detail="Hapus data terkait dari modul Hutang & Piutang")
    await db.transactions.delete_one({"id": tx_id})
    await audit(user, "delete", "transaction", tx_id, f"{existing['type']} {existing['amount']}")
    return {"ok": True}


# ---------------- Balances ----------------
@api_router.get("/balances")
async def get_balances(user=Depends(get_current_user)):
    fund_sources = await get_fund_source_names()
    result = {fs: 0.0 for fs in fund_sources}
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
    if input.fund_source not in await get_fund_source_names():
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
    await audit(user, "payment", "debt", debt_id, f"{debt['type']} {debt['party']} bayar {input.amount}")
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
    if debt.get("origin_transaction_id"):
        await db.transactions.delete_one({"id": debt["origin_transaction_id"]})
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
Kategori pemasukan: Events, Catering, Pembayaran Piutang, Hutang, Other.
Kategori pengeluaran: __EXPENSE_CATEGORIES__.
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

    expense_categories = await get_expense_category_names()
    prompt = AI_PROMPT.replace("__EXPENSE_CATEGORIES__", ", ".join(expense_categories))
    try:
        response_text = await extract_receipt(data, file.content_type, prompt)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    text = response_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        extraction = json.loads(text)
    except Exception:
        raise HTTPException(status_code=422, detail="AI tidak menghasilkan data valid, coba gambar lain")

    tx_type = extraction.get("type") if extraction.get("type") in ("income", "expense") else "unknown"
    cat = extraction.get("suggested_category")
    if cat not in INCOME_CATEGORIES + expense_categories:
        cat = None
    fs = extraction.get("suggested_fund_source")
    if fs not in await get_fund_source_names():
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
    await audit(user, "ai_extract", "transaction", doc["id"], f"draft dari {file.filename}")
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
        elif t.get("category") not in ("Piutang", "Bayar Hutang"):
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
        elif t.get("category") not in ("Piutang", "Bayar Hutang"):
            total_expense += t["amount"]
            by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]
    return {
        "month": month, "revenue": revenue, "non_revenue": non_revenue,
        "total_expense": total_expense,
        "expense_by_category": [{"category": k, "total": v} for k, v in
                                sorted(by_category.items(), key=lambda x: -x[1])],
        "net_profit": revenue - total_expense,
    }



# ---------------- Period Reports & Export ----------------
def _report_amount(value):
    return float(value or 0)


def _debt_balance_at(debt, end_date):
    paid = sum(_report_amount(p.get("amount")) for p in debt.get("payments", [])
               if (p.get("date") or "") <= end_date)
    amount = _report_amount(debt.get("amount"))
    return paid, max(0.0, amount - paid)


async def build_period_report(start_date, end_date):
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal harus YYYY-MM-DD")
    if start > end:
        raise HTTPException(status_code=400, detail="Tanggal mulai tidak boleh melewati tanggal akhir")
    if (end - start).days > 3660:
        raise HTTPException(status_code=400, detail="Rentang laporan maksimal 10 tahun")

    sources = await get_fund_source_names()
    opening = {s: 0.0 for s in sources}
    movements = {s: {"income": 0.0, "expense": 0.0, "transfer_in": 0.0, "transfer_out": 0.0} for s in sources}
    cashflow = defaultdict(lambda: {"month": "", "income": 0.0, "expense": 0.0})
    categories = defaultdict(float)
    revenue = non_revenue = expense_total = 0.0
    transactions = []

    async for tx in db.transactions.find(
        {"status": "final", "date": {"$lte": end_date}}, {"_id": 0}
    ).sort([("date", 1), ("created_at", 1)]):
        date = tx.get("date") or ""
        kind, amount = tx.get("type"), _report_amount(tx.get("amount"))
        source, dest = tx.get("fund_source"), tx.get("to_fund_source")
        if date < start_date:
            if kind == "income": opening[source] = opening.get(source, 0.0) + amount
            elif kind == "expense": opening[source] = opening.get(source, 0.0) - amount
            elif kind == "transfer":
                opening[source] = opening.get(source, 0.0) - amount
                opening[dest] = opening.get(dest, 0.0) + amount
        elif start_date <= date <= end_date:
            if kind == "income": movements.setdefault(source, {"income":0.0,"expense":0.0,"transfer_in":0.0,"transfer_out":0.0})["income"] += amount
            elif kind == "expense": movements.setdefault(source, {"income":0.0,"expense":0.0,"transfer_in":0.0,"transfer_out":0.0})["expense"] += amount
            elif kind == "transfer":
                movements.setdefault(source, {"income":0.0,"expense":0.0,"transfer_in":0.0,"transfer_out":0.0})["transfer_out"] += amount
                movements.setdefault(dest, {"income":0.0,"expense":0.0,"transfer_in":0.0,"transfer_out":0.0})["transfer_in"] += amount
            transactions.append(tx)
            month = date[:7]
            cashflow[month]["month"] = month
            if kind in ("income", "expense"): cashflow[month][kind] += amount
            category = tx.get("category") or "Tanpa Kategori"
            if kind == "income":
                if category in REVENUE_CATEGORIES: revenue += amount
                else: non_revenue += amount
            elif kind == "expense" and category not in ("Piutang", "Bayar Hutang"):
                expense_total += amount
                categories[category] += amount

    balances = []
    for name in sources:
        m = movements[name]
        closing = opening[name] + m["income"] - m["expense"] + m["transfer_in"] - m["transfer_out"]
        balances.append({"name":name,"opening":opening[name],**m,"closing":closing})

    debts = []
    async for debt in db.debts.find({"date": {"$lte": end_date}}, {"_id": 0}):
        paid, remaining = _debt_balance_at(debt, end_date)
        debts.append({"id":debt.get("id"),"type":debt.get("type"),"party":debt.get("party"),
            "date":debt.get("date"),"due_date":debt.get("due_date"),"amount":_report_amount(debt.get("amount")),
            "paid":paid,"remaining":remaining,"status":"Lunas" if remaining <= 0 else "Outstanding"})

    flow = [cashflow[k] for k in sorted(cashflow)]
    return {
        "start_date":start_date,"end_date":end_date,"transactions":transactions,
        "transaction_count":len(transactions),"revenue":revenue,"non_revenue":non_revenue,
        "total_expense":expense_total,"net_profit":revenue-expense_total,
        "total_income_cash":sum(x["income"] for x in flow),
        "total_expense_cash":sum(x["expense"] for x in flow),"cashflow":flow,
        "expense_by_category":[{"category":k,"total":v} for k,v in sorted(categories.items(),key=lambda x:-x[1])],
        "balances":balances,"balance_total_opening":sum(x["opening"] for x in balances),
        "balance_total_closing":sum(x["closing"] for x in balances),"debts":debts,
        "debt_outstanding":sum(x["remaining"] for x in debts if x["type"]=="hutang"),
        "receivable_outstanding":sum(x["remaining"] for x in debts if x["type"]=="piutang"),
    }


@api_router.get("/reports/period")
async def report_period(start_date: str, end_date: str, user=Depends(get_current_user)):
    return await build_period_report(start_date, end_date)


@api_router.get("/reports/export")
async def export_period_report(start_date: str, end_date: str,
    format: str = Query("xlsx", regex="^(pdf|xlsx)$"), user=Depends(get_current_user)):
    r = await build_period_report(start_date, end_date)
    filename = f"sariwarasa-report-{start_date}-to-{end_date}"

    if format == "xlsx":
        wb = Workbook()
        ws = wb.active; ws.title = "Summary"
        ws.append(["SARIWARASA - LAPORAN KEUANGAN"])
        ws.append(["Periode", start_date, "s.d.", end_date]); ws.append([])
        ws.append(["Indikator", "Nilai (IDR)"])
        metrics = [
            ("Revenue",r["revenue"]),("Non-Revenue",r["non_revenue"]),
            ("Pengeluaran Operasional",r["total_expense"]),("Laba Bersih",r["net_profit"]),
            ("Pemasukan Kas",r["total_income_cash"]),("Pengeluaran Kas",r["total_expense_cash"]),
            ("Saldo Awal",r["balance_total_opening"]),("Saldo Akhir",r["balance_total_closing"]),
            ("Hutang Outstanding",r["debt_outstanding"]),("Piutang Outstanding",r["receivable_outstanding"]),
            ("Jumlah Transaksi",r["transaction_count"])]
        for row in metrics: ws.append(list(row))

        ws=wb.create_sheet("P&L")
        ws.append(["Kategori","Nilai (IDR)"])
        for row in [("Revenue",r["revenue"]),("Non-Revenue",r["non_revenue"]),
                    ("Total Pengeluaran",r["total_expense"]),("Laba Bersih",r["net_profit"])]:
            ws.append(list(row))
        ws.append([]); ws.append(["Pengeluaran per Kategori","Nilai (IDR)"])
        for x in r["expense_by_category"]: ws.append([x["category"],x["total"]])

        ws=wb.create_sheet("Cash Flow")
        ws.append(["Bulan","Pemasukan","Pengeluaran","Net Cash Flow"])
        for x in r["cashflow"]: ws.append([x["month"],x["income"],x["expense"],x["income"]-x["expense"]])
        ws.append(["TOTAL",r["total_income_cash"],r["total_expense_cash"],r["total_income_cash"]-r["total_expense_cash"]])

        ws=wb.create_sheet("Saldo")
        ws.append(["Sumber Dana","Saldo Awal","Pemasukan","Pengeluaran","Transfer Masuk","Transfer Keluar","Saldo Akhir"])
        for x in r["balances"]: ws.append([x["name"],x["opening"],x["income"],x["expense"],x["transfer_in"],x["transfer_out"],x["closing"]])
        ws.append(["TOTAL",r["balance_total_opening"],sum(x["income"] for x in r["balances"]),
            sum(x["expense"] for x in r["balances"]),sum(x["transfer_in"] for x in r["balances"]),
            sum(x["transfer_out"] for x in r["balances"]),r["balance_total_closing"]])

        ws=wb.create_sheet("Hutang-Piutang")
        ws.append(["Jenis","Pihak","Tanggal","Jatuh Tempo","Nilai Awal","Sudah Dibayar","Sisa Akhir Periode","Status"])
        for x in r["debts"]: ws.append([x["type"],x["party"],x["date"],x["due_date"],x["amount"],x["paid"],x["remaining"],x["status"]])

        ws=wb.create_sheet("Detail Transaksi")
        ws.append(["Tanggal","Jenis","Kategori","Deskripsi","Event","Sumber Dana","Tujuan Transfer","Nominal (IDR)","Status"])
        for x in r["transactions"]:
            ws.append([x.get("date"),x.get("type"),x.get("category"),x.get("notes"),x.get("event_name"),
                       x.get("fund_source"),x.get("to_fund_source"),_report_amount(x.get("amount")),x.get("status")])

        header=PatternFill("solid",fgColor="17365D")
        for sheet in wb.worksheets:
            sheet.freeze_panes="A2"
            for cell in sheet[1]:
                cell.font=Font(bold=True,color="FFFFFF"); cell.fill=header
            for col in sheet.columns:
                letter=get_column_letter(col[0].column)
                width=max((len(str(c.value or "")) for c in col),default=12)
                sheet.column_dimensions[letter].width=min(max(width+2,14),42)
            for row in sheet.iter_rows(min_row=2):
                for cell in row:
                    if isinstance(cell.value,(int,float)): cell.number_format='#,##0;[Red]-#,##0'
        stream=io.BytesIO(); wb.save(stream); stream.seek(0)
        return StreamingResponse(stream,media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition":f'attachment; filename="{filename}.xlsx"'})

    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportSmall",parent=styles["BodyText"],fontSize=7,leading=9))
    stream=io.BytesIO()
    doc=SimpleDocTemplate(stream,pagesize=landscape(A4),rightMargin=10*mm,leftMargin=10*mm,topMargin=10*mm,bottomMargin=10*mm)
    story=[Paragraph("SARIWARASA - LAPORAN KEUANGAN",styles["Title"]),
           Paragraph(f"Periode: {start_date} s.d. {end_date}",styles["Normal"]),Spacer(1,5*mm)]
    summary=[["Indikator","Nilai (IDR)"]]+[[k,f"{v:,.0f}" if isinstance(v,(int,float)) else str(v)] for k,v in [
        ("Revenue",r["revenue"]),("Non-Revenue",r["non_revenue"]),("Pengeluaran Operasional",r["total_expense"]),
        ("Laba Bersih",r["net_profit"]),("Pemasukan Kas",r["total_income_cash"]),("Pengeluaran Kas",r["total_expense_cash"]),
        ("Saldo Awal",r["balance_total_opening"]),("Saldo Akhir",r["balance_total_closing"]),
        ("Hutang Outstanding",r["debt_outstanding"]),("Piutang Outstanding",r["receivable_outstanding"]),("Jumlah Transaksi",r["transaction_count"])]]
    table_style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#17365D")),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("GRID",(0,0),(-1,-1),.3,colors.HexColor("#CBD5E1")),("FONTSIZE",(0,0),(-1,-1),8),("PADDING",(0,0),(-1,-1),4)])
    story += [Paragraph("Ringkasan",styles["Heading2"]),Table(summary,colWidths=[80*mm,50*mm],style=table_style),Spacer(1,4*mm)]
    cats=[["Kategori Pengeluaran","Total (IDR)"]]+[[x["category"],f'{x["total"]:,.0f}'] for x in r["expense_by_category"]]
    if len(cats)==1: cats.append(["Tidak ada pengeluaran","0"])
    story += [Paragraph("Pengeluaran per Kategori",styles["Heading2"]),Table(cats,style=table_style),Spacer(1,4*mm)]
    bal=[["Sumber Dana","Saldo Awal","Pemasukan","Pengeluaran","Transfer Masuk","Transfer Keluar","Saldo Akhir"]]
    for x in r["balances"]: bal.append([x["name"]]+[f'{x[k]:,.0f}' for k in ("opening","income","expense","transfer_in","transfer_out","closing")])
    story += [Paragraph("Saldo per Sumber Dana",styles["Heading2"]),Table(bal,repeatRows=1,style=table_style),Spacer(1,4*mm)]
    debt=[["Jenis","Pihak","Tanggal","Jatuh Tempo","Nilai Awal","Dibayar","Sisa","Status"]]
    for x in r["debts"]: debt.append([x["type"],x["party"],x["date"],x["due_date"] or "-",f'{x["amount"]:,.0f}',f'{x["paid"]:,.0f}',f'{x["remaining"]:,.0f}',x["status"]])
    if len(debt)==1: debt.append(["-","Tidak ada data","-","-","0","0","0","-"])
    story += [Paragraph("Hutang & Piutang per Akhir Periode",styles["Heading2"]),Table(debt,repeatRows=1,style=table_style),PageBreak(),Paragraph("Detail Transaksi",styles["Heading2"])]
    detail=[["Tanggal","Jenis","Kategori","Deskripsi","Event","Sumber Dana","Tujuan","Nominal"]]
    for x in r["transactions"]:
        detail.append([x.get("date") or "-",x.get("type") or "-",x.get("category") or "-",
            Paragraph(str(x.get("notes") or "-")[:150],styles["ReportSmall"]),
            Paragraph(str(x.get("event_name") or "-")[:70],styles["ReportSmall"]),
            x.get("fund_source") or "-",x.get("to_fund_source") or "-",f'{_report_amount(x.get("amount")):,.0f}'])
    if len(detail)==1: detail.append(["-","-","-","Tidak ada transaksi","-","-","-","0"])
    story.append(Table(detail,repeatRows=1,colWidths=[22*mm,17*mm,25*mm,53*mm,34*mm,25*mm,22*mm,25*mm],
        style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#17365D")),("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("GRID",(0,0),(-1,-1),.25,colors.HexColor("#CBD5E1")),("FONTSIZE",(0,0),(-1,-1),7),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),3)])))
    doc.build(story); stream.seek(0)
    return StreamingResponse(stream,media_type="application/pdf",
        headers={"Content-Disposition":f'attachment; filename="{filename}.pdf"'})


# ---------------- Startup ----------------
@app.on_event("startup")
async def startup():
    seed_password = os.environ.get("SEED_PASSWORD")
    if seed_password:
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
                    "password_hash": bcrypt.hashpw(seed_password.encode(), bcrypt.gensalt()).decode(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"Seeded user {email} ({role})")
    else:
        logger.info("SEED_PASSWORD tidak diset — skip seeding akun default")
    if storage_configured():
        logger.info("S3-compatible storage configured")
    else:
        logger.warning("Storage belum dikonfigurasi — set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY untuk upload file")


app.include_router(api_router)

# Production: set CORS_ORIGINS ke URL frontend Vercel, cth: CORS_ORIGINS="https://app.vercel.app"
# Auth memakai Bearer token (bukan cookie), sehingga "*" juga valid tanpa credentials.
_cors_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()