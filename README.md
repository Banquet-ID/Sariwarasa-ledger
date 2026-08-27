# Sariwarasa Finance Ledger

Aplikasi keuangan internal Sariwarasa: pencatatan pemasukan, pengeluaran, mutasi antar sumber dana, hutang-piutang dengan cicilan, revenue event, draft transaksi dari gambar via AI, dan laporan dasar.

## Struktur

```
/
├── frontend/   # React (CRA + CRACO + Tailwind + shadcn/ui)
└── backend/    # FastAPI + MongoDB (serverless-ready untuk Vercel)
```

Frontend dan backend di-deploy sebagai **dua project Vercel terpisah**.

## Local Development

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # isi nilainya
uvicorn server:app --reload --port 8001
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # isi REACT_APP_BACKEND_URL=http://localhost:8001
npm start
```

Node.js: **v20** (lihat `frontend/.nvmrc`). Package manager: **npm** (package-lock.json adalah source of truth; `npm install` dan `npm run build` harus berhasil tanpa --force/--legacy-peer-deps).

## Environment Variables

### Backend (`backend/.env` / Vercel env)
| Variable | Wajib | Keterangan |
|---|---|---|
| `MONGO_URL` | Ya | Connection string MongoDB Atlas, cth `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority` |
| `DB_NAME` | Ya | Nama database, cth `sariwarasa` |
| `JWT_SECRET` | Ya | Secret random untuk JWT (min 32 karakter) |
| `CORS_ORIGINS` | Ya | URL frontend production, cth `https://app.vercel.app` (tanpa trailing slash) |
| `OWNER_EMAIL` | Opsional | Email yang otomatis dapat role owner saat login Google pertama kali |
| `SEED_PASSWORD` | Opsional | Jika diset, startup membuat akun owner & team default dengan password ini |
| `GOOGLE_CLIENT_ID` | Untuk login Google | OAuth Client ID (Web) dari Google Cloud Console |
| `AI_PROVIDER` | Untuk AI draft | Default `openai` |
| `OPENAI_API_KEY` | Untuk AI draft | API key OpenAI (fitur ekstraksi gambar) |
| `AI_MODEL` | Opsional | Default `gpt-4o` |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Untuk lampiran | Object storage S3-compatible (AWS S3 / Cloudflare R2 / MinIO) |
| `S3_REGION`, `S3_ENDPOINT_URL` | Opsional | Region & custom endpoint (R2/MinIO) |

### Frontend (`frontend/.env` / Vercel env)
| Variable | Wajib | Keterangan |
|---|---|---|
| `REACT_APP_BACKEND_URL` | Ya | URL backend production, cth `https://api.vercel.app` |
| `REACT_APP_GOOGLE_CLIENT_ID` | Untuk login Google | Client ID yang sama dengan backend |

## Deployment (Vercel)

### Backend (project 1)
- Root Directory: `backend`
- Runtime: Python (serverless, entry: `backend/api/index.py` → `server:app`)
- `backend/vercel.json` me-rewrite semua path ke function tersebut
- Set semua env backend di atas. Frontend memanggil `<backend-url>/api/...`

### Frontend (project 2)
- Root Directory: `frontend`
- Framework: Create React App — Build Command `npm run build`, Output `build`
- `frontend/vercel.json` menangani SPA rewrite ke `index.html`
- Set `REACT_APP_BACKEND_URL` (dan `REACT_APP_GOOGLE_CLIENT_ID` bila pakai Google login)

### MongoDB Atlas
1. Buat cluster (M0 gratis), buat database user, catat connection string → `MONGO_URL`.
2. Network Access: allow dari mana saja (`0.0.0.0/0`) karena Vercel serverless tidak punya IP tetap.
3. Struktur koleksi dibuat otomatis oleh aplikasi (users, transactions, debts, files, audit_logs).

### Google OAuth (opsional, untuk tombol "Masuk dengan Google")
1. Google Cloud Console → Credentials → Create OAuth Client ID (Web).
2. Authorized JavaScript origins: URL frontend Vercel.
3. Set `GOOGLE_CLIENT_ID` (backend) dan `REACT_APP_GOOGLE_CLIENT_ID` (frontend).

## Fitur yang butuh layanan eksternal
- **Login Google**: butuh `GOOGLE_CLIENT_ID`. Tanpa itu, login email/password tetap berfungsi.
- **AI draft dari gambar**: butuh `OPENAI_API_KEY`. Tanpa itu, input manual tetap berfungsi.
- **Lampiran bukti**: butuh S3-compatible storage (`S3_*`). Tanpa itu, transaksi tanpa lampiran tetap berfungsi.

## Catatan dependency
- Konflik ajv diselesaikan dengan npm `overrides` per-major: `ajv@^6→6.12.6`, `ajv@^8→8.17.1`, `ajv-keywords@^3→3.5.2`, `ajv-keywords@^5→5.1.0` (resolutions yarn yang setara juga ada di package.json).
- `react-day-picker` dan `date-fns` dihapus — tidak dipakai (aplikasi memakai input date/month native) dan konflik dengan React 19.
