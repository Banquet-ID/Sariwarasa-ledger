import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { formatIDR, formatDate } from "@/lib/format";
import { txKind, KIND_META, amountColor, FUND_SOURCES } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import TransactionDrawer from "@/components/TransactionDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, FileWarning } from "lucide-react";
import { toast } from "sonner";

export default function Transactions() {
  const { isOwner } = useAuth();
  const [searchParams] = useSearchParams();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [filters, setFilters] = useState({
    type: "all",
    fund_source: "all",
    status: searchParams.get("status") || "all",
    month: "",
  });

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.type !== "all") params.type = filters.type;
    if (filters.fund_source !== "all") params.fund_source = filters.fund_source;
    if (filters.status !== "all") params.status = filters.status;
    if (filters.month) params.month = filters.month;
    api.get("/transactions", { params })
      .then((r) => setTxs(r.data.transactions))
      .catch(() => toast.error("Gagal memuat transaksi"))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (t) => {
    if (!window.confirm(`Hapus transaksi ${formatIDR(t.amount)} tanggal ${formatDate(t.date)}?`)) return;
    try {
      await api.delete(`/transactions/${t.id}`);
      toast.success("Transaksi dihapus");
      window.dispatchEvent(new Event("sw:refresh"));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus");
    }
  };

  const openEdit = (t) => {
    setEditTx(t);
    setDrawerOpen(true);
  };

  const drafts = txs.filter((t) => t.status === "draft");

  return (
    <div className="space-y-5" data-testid="transactions-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Transaksi</h1>
          <p className="text-sm text-slate-500 mt-0.5">Semua pemasukan, pengeluaran, dan mutasi internal.</p>
        </div>
        {isOwner && (
          <Button
            data-testid="add-transaction-btn"
            onClick={() => { setEditTx(null); setDrawerOpen(true); }}
            className="rounded-lg active:scale-95 transition-transform duration-150"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Tambah Transaksi
          </Button>
        )}
      </div>

      <div className="flex gap-3 flex-wrap" data-testid="transaction-filters">
        <Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}>
          <SelectTrigger className="w-40" data-testid="filter-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis</SelectItem>
            <SelectItem value="income">Pemasukan</SelectItem>
            <SelectItem value="expense">Pengeluaran</SelectItem>
            <SelectItem value="transfer">Mutasi Internal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.fund_source} onValueChange={(v) => setFilters((f) => ({ ...f, fund_source: v }))}>
          <SelectTrigger className="w-40" data-testid="filter-fund-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Sumber</SelectItem>
            {FUND_SOURCES.map((fs) => <SelectItem key={fs} value={fs}>{fs}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
          <SelectTrigger className="w-36" data-testid="filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="final">Final</SelectItem>
            <SelectItem value="draft">Draft AI</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="month" value={filters.month}
          onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
          className="w-44" data-testid="filter-month"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="transactions-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Tanggal</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Jenis</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Kategori / Keterangan</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Sumber Dana</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Jumlah</th>
              {isOwner && <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>
            )}
            {!loading && txs.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-400 text-sm" data-testid="transactions-empty">Belum ada transaksi.</td></tr>
            )}
            {!loading && txs.map((t) => {
              const kind = txKind(t);
              const isDraft = t.status === "draft";
              return (
                <tr
                  key={t.id}
                  data-testid={`tx-row-${t.id}`}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150 ${isDraft ? "bg-amber-50/50 border-l-4 border-l-amber-400" : ""}`}
                >
                  <td className="p-3 text-slate-600 whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${KIND_META[kind].badge}`}>
                        {KIND_META[kind].label}
                      </span>
                      {isDraft && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-amber-950 whitespace-nowrap" data-testid={`draft-badge-${t.id}`}>
                          DRAFT
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-slate-800">
                      {t.type === "transfer" ? "Mutasi Internal" : (t.category || <span className="text-amber-700 flex items-center gap-1"><FileWarning className="h-3.5 w-3.5" /> Perlu kategori</span>)}
                    </div>
                    <div className="text-xs text-slate-400 truncate max-w-[220px]">
                      {t.category === "Events" && t.event_name ? `${t.event_name} · ${t.event_location || ""} · PIC ${t.event_pic || ""}` : (t.notes || "-")}
                    </div>
                  </td>
                  <td className="p-3 text-slate-600 whitespace-nowrap">
                    {t.type === "transfer" ? `${t.fund_source} → ${t.to_fund_source}` : (t.fund_source || "-")}
                  </td>
                  <td className={`p-3 text-right font-mono font-semibold whitespace-nowrap ${amountColor(t)}`}>
                    {t.type === "expense" ? "-" : t.type === "transfer" ? "" : "+"}{formatIDR(t.amount)}
                  </td>
                  {isOwner && (
                    <td className="p-3 text-right whitespace-nowrap">
                      {isDraft ? (
                        <Button size="sm" data-testid={`review-draft-btn-${t.id}`} onClick={() => openEdit(t)}
                          className="bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold rounded-lg h-7 text-xs active:scale-95 transition-transform duration-150">
                          Review
                        </Button>
                      ) : (
                        <button onClick={() => openEdit(t)} data-testid={`edit-tx-btn-${t.id}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-150 mr-1">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(t)} data-testid={`delete-tx-btn-${t.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drafts.length > 0 && filters.status === "all" && (
        <p className="text-xs text-amber-700 font-medium" data-testid="draft-count-note">
          {drafts.length} draft AI menunggu review — baris berwarna kuning.
        </p>
      )}

      <TransactionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSaved={load}
        editTx={editTx}
      />
    </div>
  );
}
