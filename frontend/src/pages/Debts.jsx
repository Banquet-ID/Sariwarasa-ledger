import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { formatIDR, formatDate, todayStr } from "@/lib/format";
import { FUND_SOURCES } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, ChevronDown, ChevronUp, HandCoins } from "lucide-react";
import { toast } from "sonner";

const STATUS_META = {
  outstanding: { label: "Outstanding", cls: "bg-red-100 text-red-800 border border-red-200" },
  parsial: { label: "Parsial", cls: "bg-amber-100 text-amber-800 border border-amber-200" },
  lunas: { label: "Lunas", cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
};

function DebtDialog({ open, onOpenChange, type, onSaved }) {
  const [form, setForm] = useState({ party: "", amount: "", date: todayStr(), due_date: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ party: "", amount: "", date: todayStr(), due_date: "", notes: "" });
  }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/debts", {
        type, party: form.party, amount: parseFloat(form.amount) || 0,
        date: form.date, due_date: form.due_date || null, notes: form.notes,
      });
      toast.success(`${type === "hutang" ? "Hutang" : "Piutang"} tercatat`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="debt-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Catat {type === "hutang" ? "Hutang" : "Piutang"} Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pihak Terkait</Label>
            <Input value={form.party} onChange={(e) => setForm((f) => ({ ...f, party: e.target.value }))}
              placeholder={type === "hutang" ? "cth: Supplier Buah ABC" : "cth: PT Klien XYZ"} data-testid="debt-party-input" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nominal Awal (Rp)</Label>
              <Input type="number" min="0" value={form.amount} className="font-mono"
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} data-testid="debt-amount-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} data-testid="debt-date-input" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Jatuh Tempo (opsional)</Label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} data-testid="debt-due-date-input" />
          </div>
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} data-testid="debt-notes-input" />
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-debt-btn" className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onOpenChange, debt, onSaved }) {
  const [form, setForm] = useState({ amount: "", date: todayStr(), fund_source: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ amount: "", date: todayStr(), fund_source: "", notes: "" });
  }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/debts/${debt.id}/payments`, {
        amount: parseFloat(form.amount) || 0, date: form.date,
        fund_source: form.fund_source, notes: form.notes,
      });
      toast.success("Pembayaran tercatat");
      window.dispatchEvent(new Event("sw:refresh"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan pembayaran");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="payment-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Bayar {debt?.type === "hutang" ? "Hutang" : "Piutang"} — {debt?.party}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
            Sisa: <span className="font-mono font-semibold">{formatIDR(debt?.remaining)}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nominal Bayar (Rp)</Label>
              <Input type="number" min="0" value={form.amount} className="font-mono"
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} data-testid="payment-amount-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} data-testid="payment-date-input" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Sumber Dana</Label>
            <Select value={form.fund_source || undefined} onValueChange={(v) => setForm((f) => ({ ...f, fund_source: v }))}>
              <SelectTrigger data-testid="payment-fund-source-select"><SelectValue placeholder="Pilih sumber dana" /></SelectTrigger>
              <SelectContent>
                {FUND_SOURCES.map((fs) => <SelectItem key={fs} value={fs}>{fs}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} data-testid="payment-notes-input" />
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-payment-btn" className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            Catat Pembayaran
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Debts() {
  const { isOwner } = useAuth();
  const [tab, setTab] = useState("hutang");
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [debtDialog, setDebtDialog] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    api.get("/debts", { params: { type: tab } })
      .then((r) => setDebts(r.data.debts))
      .catch(() => toast.error("Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const deleteDebt = async (d) => {
    if (!window.confirm(`Hapus ${d.type} ${d.party}? Semua riwayat pembayaran ikut terhapus.`)) return;
    try {
      await api.delete(`/debts/${d.id}`);
      toast.success("Data dihapus");
      window.dispatchEvent(new Event("sw:refresh"));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus");
    }
  };

  const deletePayment = async (d, p) => {
    if (!window.confirm(`Hapus pembayaran ${formatIDR(p.amount)}?`)) return;
    try {
      await api.delete(`/debts/${d.id}/payments/${p.id}`);
      toast.success("Pembayaran dihapus");
      window.dispatchEvent(new Event("sw:refresh"));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus pembayaran");
    }
  };

  const totalOutstanding = debts.reduce((s, d) => s + d.remaining, 0);
  const isHutang = tab === "hutang";

  return (
    <div className="space-y-5" data-testid="debts-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Hutang & Piutang</h1>
          <p className="text-sm text-slate-500 mt-0.5">Kelola kewajiban dan tagihan dengan cicilan parsial.</p>
        </div>
        {isOwner && (
          <Button data-testid="add-debt-btn" onClick={() => setDebtDialog(true)}
            className="rounded-lg active:scale-95 transition-transform duration-150">
            <Plus className="h-4 w-4 mr-1.5" /> Catat {isHutang ? "Hutang" : "Piutang"}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-2 w-72">
          <TabsTrigger value="hutang" data-testid="tab-hutang" className="data-[state=active]:bg-red-100 data-[state=active]:text-red-800">Hutang</TabsTrigger>
          <TabsTrigger value="piutang" data-testid="tab-piutang" className="data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-800">Piutang</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className={`rounded-lg border p-5 ${isHutang ? "border-red-200 bg-red-50" : "border-indigo-200 bg-indigo-50"}`} data-testid="debts-outstanding-card">
        <div className={`text-xs font-bold uppercase tracking-wider ${isHutang ? "text-red-700" : "text-indigo-700"}`}>
          Total {isHutang ? "Hutang" : "Piutang"} Outstanding
        </div>
        <div className={`font-mono text-2xl font-semibold tracking-tight mt-1 ${isHutang ? "text-red-900" : "text-indigo-900"}`}>
          {formatIDR(totalOutstanding)}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400">Memuat...</p>}
      {!loading && debts.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400" data-testid="debts-empty">
          Belum ada {isHutang ? "hutang" : "piutang"} tercatat.
        </div>
      )}

      <div className="space-y-3">
        {debts.map((d) => {
          const pct = d.amount > 0 ? Math.round((d.paid / d.amount) * 100) : 0;
          const meta = STATUS_META[d.status] || STATUS_META.outstanding;
          const isOpen = expanded[d.id];
          return (
            <div key={d.id} data-testid={`debt-card-${d.id}`} className="rounded-lg border border-slate-200 bg-white shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{d.party}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.cls}`} data-testid={`debt-status-${d.id}`}>{meta.label}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {formatDate(d.date)}{d.due_date ? ` · Jatuh tempo ${formatDate(d.due_date)}` : ""}{d.notes ? ` · ${d.notes}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">Sisa</div>
                  <div className={`font-mono font-semibold ${isHutang ? "text-red-700" : "text-indigo-700"}`}>{formatIDR(d.remaining)}</div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Progress value={pct} className="h-2 flex-1" />
                <span className="text-xs font-mono text-slate-500 whitespace-nowrap">{formatIDR(d.paid)} / {formatIDR(d.amount)}</span>
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {isOwner && d.remaining > 0 && (
                  <Button size="sm" data-testid={`pay-debt-btn-${d.id}`} onClick={() => setPayTarget(d)}
                    className={`rounded-lg h-7 text-xs active:scale-95 transition-transform duration-150 ${isHutang ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>
                    <HandCoins className="h-3.5 w-3.5 mr-1" /> Bayar Cicilan
                  </Button>
                )}
                {d.payments?.length > 0 && (
                  <button onClick={() => setExpanded((e) => ({ ...e, [d.id]: !e[d.id] }))}
                    data-testid={`toggle-history-btn-${d.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors duration-150">
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    Riwayat ({d.payments.length})
                  </button>
                )}
                {isOwner && (
                  <button onClick={() => deleteDebt(d)} data-testid={`delete-debt-btn-${d.id}`}
                    className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5" data-testid={`payment-history-${d.id}`}>
                  {d.payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 text-xs py-1">
                      <span className="text-slate-400 whitespace-nowrap">{formatDate(p.date)}</span>
                      <span className="font-mono font-semibold text-slate-800">{formatIDR(p.amount)}</span>
                      <span className="text-slate-500">{p.fund_source}</span>
                      {p.notes && <span className="text-slate-400 truncate">{p.notes}</span>}
                      {isOwner && (
                        <button onClick={() => deletePayment(d, p)} data-testid={`delete-payment-btn-${p.id}`}
                          className="ml-auto p-1 rounded text-slate-300 hover:text-rose-600 transition-colors duration-150">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DebtDialog open={debtDialog} onOpenChange={setDebtDialog} type={tab} onSaved={load} />
      <PaymentDialog open={!!payTarget} onOpenChange={(v) => !v && setPayTarget(null)} debt={payTarget} onSaved={load} />
    </div>
  );
}
