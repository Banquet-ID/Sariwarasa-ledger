import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { formatIDR, formatDate, currentMonth } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { Scale } from "lucide-react";

export default function Reports() {
  const { isOwner } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [pnl, setPnl] = useState(null);
  const [cashflow, setCashflow] = useState([]);
  const [balances, setBalances] = useState(null);
  const [debts, setDebts] = useState([]);
  const [logs, setLogs] = useState([]);

  const load = useCallback(() => {
    api.get("/reports/pnl", { params: month ? { month } : {} }).then((r) => setPnl(r.data)).catch(() => {});
    api.get("/reports/cashflow?months=6").then((r) => setCashflow(r.data.months)).catch(() => {});
    api.get("/balances").then((r) => setBalances(r.data)).catch(() => {});
    api.get("/debts").then((r) => setDebts(r.data.debts)).catch(() => {});
    if (isOwner) api.get("/audit-logs").then((r) => setLogs(r.data.logs)).catch(() => {});
  }, [month, isOwner]);

  useEffect(() => { load(); }, [load]);

  const openDebts = debts.filter((d) => d.remaining > 0);

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Laporan</h1>
          <p className="text-sm text-slate-500 mt-0.5">Arus kas, laba rugi sederhana, dan posisi hutang-piutang.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Periode</span>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="report-month-filter" />
        </div>
      </div>

      {/* Laba Rugi */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="pnl-card">
        <div className="flex items-center gap-2 mb-4">
          <Scale className="h-4 w-4 text-slate-500" />
          <h3 className="font-heading text-lg font-medium text-slate-800">Laba Rugi Sederhana {month ? `— ${month}` : ""}</h3>
        </div>
        {pnl && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">Revenue</div>
              <div className="font-mono text-lg font-semibold text-emerald-700 mt-1" data-testid="pnl-revenue">{formatIDR(pnl.revenue)}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-600">Non-Revenue</div>
              <div className="font-mono text-lg font-semibold text-cyan-700 mt-1" data-testid="pnl-non-revenue">{formatIDR(pnl.non_revenue)}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-rose-600">Total Pengeluaran</div>
              <div className="font-mono text-lg font-semibold text-rose-700 mt-1" data-testid="pnl-expense">{formatIDR(pnl.total_expense)}</div>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-600">Laba Bersih (Revenue − Biaya)</div>
              <div className={`font-mono text-lg font-semibold mt-1 ${pnl.net_profit >= 0 ? "text-emerald-700" : "text-rose-700"}`} data-testid="pnl-net">
                {formatIDR(pnl.net_profit)}
              </div>
            </div>
          </div>
        )}
        {pnl && pnl.expense_by_category.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Pengeluaran per Kategori</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5" data-testid="pnl-category-table">
              {pnl.expense_by_category.map((c) => (
                <div key={c.category} className="flex justify-between text-sm py-1 border-b border-slate-50">
                  <span className="text-slate-600">{c.category}</span>
                  <span className="font-mono font-medium text-rose-700">{formatIDR(c.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Arus kas */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-cashflow-card">
        <h3 className="font-heading text-lg font-medium text-slate-800 mb-4">Arus Kas Bulanan</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cashflow} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b", fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false}
                tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}jt` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}rb` : v)}
              />
              <Tooltip
                formatter={(v, name) => [formatIDR(v), name === "income" ? "Pemasukan" : "Pengeluaran"]}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
              />
              <Legend formatter={(v) => (v === "income" ? "Pemasukan" : "Pengeluaran")} />
              <Bar dataKey="income" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#e11d48" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Saldo per sumber dana */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-balance-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Saldo per Sumber Dana</h3>
          <table className="w-full text-sm">
            <tbody>
              {balances?.balances.map((b) => (
                <tr key={b.name} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-600">{b.name}</td>
                  <td className={`py-2 text-right font-mono font-semibold ${b.balance < 0 ? "text-rose-600" : "text-slate-900"}`}>
                    {formatIDR(b.balance)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td className="py-2 font-bold text-slate-900">Total</td>
                <td className="py-2 text-right font-mono font-bold text-slate-900">{formatIDR(balances?.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Hutang piutang outstanding */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-debts-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Hutang & Piutang Outstanding</h3>
          {openDebts.length === 0 && <p className="text-sm text-slate-400">Tidak ada yang outstanding.</p>}
          <div className="space-y-1.5">
            {openDebts.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.type === "hutang" ? "bg-red-100 text-red-800" : "bg-indigo-100 text-indigo-800"}`}>
                  {d.type === "hutang" ? "Hutang" : "Piutang"}
                </span>
                <span className="text-slate-700 truncate flex-1">{d.party}</span>
                <span className="font-mono font-semibold text-slate-900">{formatIDR(d.remaining)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audit log */}
      {isOwner && logs.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="audit-log-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Audit Log</h3>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-slate-50 last:border-0">
                <span className="text-slate-400 whitespace-nowrap font-mono">{formatDate(l.created_at)}</span>
                <span className="text-slate-500 whitespace-nowrap">{l.email}</span>
                <span className="font-bold text-slate-700 uppercase text-[10px]">{l.action}</span>
                <span className="text-slate-600 truncate">{l.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
