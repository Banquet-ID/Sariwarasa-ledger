# PRD — Web App Keuangan Sariwarasa

## Problem Statement (ringkas)
Web app internal untuk mencatat pemasukan, pengeluaran, hutang, piutang, dan saldo sumber dana Sariwarasa. Input manual + bantuan AI dari gambar (nota, mutasi bank, invoice, tulisan tangan) sebagai DRAFT yang direview sebelum final. Owner full access, team view-only. Bukan sistem akuntansi penuh — fokus kontrol arus kas.

## User Personas
- **Owner** (andhry.adhriyanto@gmail.com): full access, satu-satunya yang input/edit/hapus di MVP.
- **Team** (team@sariwarasa.com): view only di semua halaman.

## Arsitektur
- Frontend: React (CRA + craco), Tailwind + Shadcn UI, recharts, sonner. Bahasa Indonesia.
- Backend: FastAPI single module `/app/backend/server.py`, prefix `/api`.
- DB: MongoDB (motor). Koleksi: users, user_sessions, transactions, debts, files, audit_logs.
- Auth ganda: JWT email/password (bcrypt) + Emergent-managed Google OAuth (session cookie). Email owner auto-role owner; Google user lain auto-role team.
- AI: OpenAI gpt-5.6-terra via emergentintegrations + EMERGENT_LLM_KEY (vision, JSON extraction).
- Storage: Emergent Object Storage (path prefix `sariwarasa/`), file disajikan via `GET /api/files/{path}` dengan auth.
- Saldo dihitung on-the-fly dari transaksi final (mutasi internal tidak masuk revenue/expense).

## Implemented (2026-08-22) — Phase 1–6 sekaligus
- [x] Auth JWT + Google OAuth, seed owner/team, RBAC owner/team (403 untuk write oleh team)
- [x] Master data: 6 sumber dana, kategori pemasukan (Revenue/Non-revenue) & 11 kategori pengeluaran
- [x] Ledger transaksi masuk/keluar + mutasi internal, filter, edit/hapus, lampiran bukti
- [x] Validasi: kategori Other/Lainnya wajib catatan; event wajib nama/lokasi/PIC
- [x] Balance ticker sticky selalu terlihat di semua halaman
- [x] Revenue event: form khusus + rekap per event
- [x] Hutang/piutang: cicilan parsial, riwayat, status outstanding/parsial/lunas, pembayaran auto-membuat transaksi ledger (Bayar Hutang / Pembayaran Piutang)
- [x] AI image ingestion → draft amber "Belum Final" → review drawer → simpan final
- [x] Laporan: arus kas, P&L sederhana, saldo per sumber, hutang/piutang outstanding, audit log
- [x] Duplicate warning dasar (jenis+nominal+tanggal+sumber sama)
- [x] Testing: 22/22 pytest backend, semua flow UI kritis lulus (iteration_1.json)

## Backlog
### P0
- (Belum ada — semua core lulus)

### P1
- Role ketiga "input-transaksi" saat volume naik (keputusan produk: view-only bukan struktur final)
- Reminder jatuh tempo hutang/piutang (open question)
- Master kategori/sumber dana yang bisa diedit via UI (sekarang konstanta backend)
- Cleanup draft AI yang ditinggalkan (TTL/cron)

### P2
- Pembayaran campur multi-sumber dana (open question, belum didukung)
- Deteksi duplikat lebih pintar (tampilkan transaksi yang match)
- Agregasi saldo materialized untuk skala data besar
- Async file serving (httpx) & split server.py per router

## Test Credentials
Lihat /app/memory/test_credentials.md. Playbooks: /app/auth_testing.md, /app/image_testing.md.

## Next Tasks
1. Validasi user terhadap data operasional nyata.
2. Putuskan open questions (reminder jatuh tempo, multi-source payment).
3. Tambah role input-transaksi jika owner jadi bottleneck.
