import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { formatIDR, formatDate } from "@/lib/format";
import { txKind, KIND_META, amountColor } from "@/lib/constants";
import { TrendingUp, TrendingDown, HandCoins, Receipt, AlertTriangle, ArrowRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [cashflow, setCashflow] = useState([]);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api.get("/reports/summary").then((r) => setSummary(r.data)).catch(() => {});
    api.get("/reports/cashflow?months=6").then((r) => setCashflow(r.data.months)).catch(() => {});
    api.get("/transactions?limit=8").then((r) => setRecent(r.data.transactions)).catch(() => {});
  }, []);

  const cards = [
    { key: "income", label: "Total Pemasukan", value: summary?.total_income, icon: TrendingUp, cls: "text-emerald-700 bg-emerald-100", testid: "summary-income" },
    { key: "expense", label: "Total Pengeluaran", value: summary?.total_expense, icon: TrendingDown, cls: "text-rose-700 bg-rose-100", testid: "summary-expense" },
    { key: "hutang", label: "Hutang Outstanding", value: summary?.hutang_outstanding, icon: Receipt, cls: "text-red-700 bg-red-100", testid: "summary-debt" },
    { key: "piutang", label: "Piutang Outstanding", value: summary?.piutang_outstanding, icon: HandCoins, cls: "text-indigo-700 bg-indigo-100", testid: "summary-receivable" },
  ];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ringkasan arus kas Sariwarasa.</p>
      </div>

      {summary?.draft_count > 0 && (
        <Link
          to="/transaksi?status=draft"
          data-testid="draft-alert-banner"
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100 transition-colors duration-150"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            Ada {summary.draft_count} draft AI yang belum final — periksa dan simpan.
          </span>
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.key} data-testid={c.testid} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</span>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c.cls}`}>
                <c.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="font-mono text-xl font-semibold tracking-tight text-slate-900 mt-2">
              {summary ? formatIDR(c.value) : <span className="inline-block h-6 w-28 bg-slate-100 rounded animate-pulse" />}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="cashflow-chart-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-4">Arus Kas 6 Bulan Terakhir</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashflow} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e11d48" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}jt` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}rb` : v)}
                />
                <Tooltip
                  formatter={(v, name) => [formatIDR(v), name === "income" ? "Pemasukan" : "Pengeluaran"]}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="income" stroke="#059669" strokeWidth={2} fill="url(#gIncome)" name="income" />
                <Area type="monotone" dataKey="expense" stroke="#e11d48" strokeWidth={2} fill="url(#gExpense)" name="expense" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="recent-activity-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading text-lg font-medium text-slate-800">Aktivitas Terakhir</h3>
            <Link to="/transaksi" data-testid="view-all-transactions-link" className="text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors duration-150">
              Lihat semua
            </Link>
          </div>
          <div className="space-y-2">
            {recent.length === 0 && <p className="text-sm text-slate-400">Belum ada transaksi.</p>}
            {recent.map((t) => {
              const kind = txKind(t);
              return (
                <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KIND_META[kind].badge}`}>
                    {KIND_META[kind].label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-800 truncate">
                      {t.type === "transfer" ? `${t.fund_source} → ${t.to_fund_source}` : (t.category || "-")}
                    </div>
                    <div className="text-[10px] text-slate-400">{formatDate(t.date)}</div>
                  </div>
                  <div className={`font-mono text-xs font-semibold ${amountColor(t)}`}>
                    {t.type === "expense" ? "-" : t.type === "transfer" ? "" : "+"}{formatIDR(t.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
