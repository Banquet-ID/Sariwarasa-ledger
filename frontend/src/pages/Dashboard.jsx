import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { formatIDR, formatDate } from "@/lib/format";
import { txKind, KIND_META, amountColor } from "@/lib/constants";
import { TrendingUp, TrendingDown, HandCoins, Receipt, AlertTriangle, ArrowRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function localDate(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export default function Dashboard() {
  const [report, setReport] = useState(null);
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [endDate, setEndDate] = useState(() => localDate(new Date()));

  const load = useCallback(() => {
    if (!startDate || !endDate || startDate > endDate) return;
    setLoading(true);
    Promise.all([
      api.get("/reports/period", { params: { start_date: startDate, end_date: endDate } }),
      api.get("/reports/summary"),
    ]).then(([periodRes, summaryRes]) => {
      setReport(periodRes.data);
      setSummary(summaryRes.data);
      setRecent([...(periodRes.data.transactions || [])].reverse().slice(0, 8));
    }).catch((e) => toast.error(e.response?.data?.detail || "Gagal memuat dashboard"))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const cards = [
    { key: "income", label: "Total Pemasukan", value: report ? report.revenue + report.non_revenue : 0, icon: TrendingUp, cls: "text-emerald-700 bg-emerald-100", testid: "summary-income" },
    { key: "expense", label: "Total Pengeluaran", value: report?.total_expense, icon: TrendingDown, cls: "text-rose-700 bg-rose-100", testid: "summary-expense" },
    { key: "hutang", label: "Hutang Outstanding", value: report?.debt_outstanding, icon: Receipt, cls: "text-red-700 bg-red-100", testid: "summary-debt" },
    { key: "piutang", label: "Piutang Outstanding", value: report?.receivable_outstanding, icon: HandCoins, cls: "text-indigo-700 bg-indigo-100", testid: "summary-receivable" },
  ];

  const setPreset = (preset) => {
    const today = new Date();
    const end = localDate(today);
    let start;
    if (preset === "today") start = end;
    else if (preset === "month") start = localDate(new Date(today.getFullYear(), today.getMonth(), 1));
    else if (preset === "year") start = localDate(new Date(today.getFullYear(), 0, 1));
    else start = localDate(new Date(today.getFullYear(), today.getMonth() - 5, 1));
    setStartDate(start);
    setEndDate(end);
  };

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Ringkasan arus kas Sariwarasa berdasarkan periode.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-testid="dashboard-period-filter">
          <div><label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1">Mulai</label>
            <Input type="date" value={startDate} max={endDate || undefined} onChange={e => setStartDate(e.target.value)} className="w-36" data-testid="dashboard-start-date" /></div>
          <div><label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1">Akhir</label>
            <Input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className="w-36" data-testid="dashboard-end-date" /></div>
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setPreset("today")}>Hari ini</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("month")}>Bulan ini</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("year")}>Tahun ini</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("6months")}>6 bulan</Button>
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500">Periode aktif: <span className="font-semibold text-slate-700">{startDate} — {endDate}</span></div>

      {summary?.draft_count > 0 && (
        <Link to="/transaksi?status=draft" data-testid="draft-alert-banner"
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100 transition-colors duration-150">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Ada {summary.draft_count} draft AI yang belum final — periksa dan simpan.</span>
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Link>
      )}

      {loading && <p className="text-sm text-slate-500">Memuat data periode...</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.key} data-testid={c.testid} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</span>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c.cls}`}><c.icon className="h-4 w-4" /></div>
            </div>
            <div className="font-mono text-xl font-semibold tracking-tight text-slate-900 mt-2">
              {report ? formatIDR(c.value) : <span className="inline-block h-6 w-28 bg-slate-100 rounded animate-pulse" />}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="cashflow-chart-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-1">Arus Kas dalam Periode</h3>
          <p className="text-xs text-slate-500 mb-4">Pemasukan dan pengeluaran bulanan sesuai tanggal yang dipilih.</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={report?.cashflow || []} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#059669" stopOpacity={0.25} /><stop offset="100%" stopColor="#059669" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e11d48" stopOpacity={0.25} /><stop offset="100%" stopColor="#e11d48" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b", fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(0)}jt` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}rb` : v} />
                <Tooltip formatter={(v, name) => [formatIDR(v), name === "income" ? "Pemasukan" : "Pengeluaran"]} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Area type="monotone" dataKey="income" stroke="#059669" strokeWidth={2} fill="url(#gIncome)" name="income" />
                <Area type="monotone" dataKey="expense" stroke="#e11d48" strokeWidth={2} fill="url(#gExpense)" name="expense" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="recent-activity-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading text-lg font-medium text-slate-800">Aktivitas Terakhir</h3>
            <Link to="/transaksi" data-testid="view-all-transactions-link" className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors duration-150">Lihat semua</Link>
          </div>
          <div className="space-y-2">
            {!loading && recent.length === 0 && <p className="text-sm text-slate-400">Tidak ada transaksi pada periode ini.</p>}
            {recent.map(t => {
              const kind = txKind(t);
              return <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KIND_META[kind].badge}`}>{KIND_META[kind].label}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800 truncate">{t.type === "transfer" ? `${t.fund_source} → ${t.to_fund_source}` : (t.category || "-")}</div>
                  <div className="text-[10px] text-slate-400">{formatDate(t.date)}</div>
                </div>
                <div className={`font-mono text-xs font-semibold ${amountColor(t)}`}>{t.type === "expense" ? "-" : t.type === "transfer" ? "" : "+"}{formatIDR(t.amount)}</div>
              </div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
