import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Building2, Wallet, CreditCard, Landmark } from "lucide-react";
import { toast } from "sonner";

function FundSourceDialog({ open, onOpenChange, fundSource, onSaved }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!fundSource;

  useEffect(() => {
    if (open) setName(fundSource?.name || "");
  }, [open, fundSource]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Nama sumber dana wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/fund-sources/${fundSource.id}`, { name });
        toast.success("Sumber dana diperbarui");
      } else {
        await api.post("/fund-sources", { name });
        toast.success("Sumber dana ditambahkan");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan sumber dana");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="fund-source-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit Sumber Dana / Bank" : "Tambah Sumber Dana / Bank"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama sumber dana / bank</Label>
            <Input
              value={name} maxLength={50} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="cth: BCA Syariah, DANA, GoPay" data-testid="fund-source-name-input"
            />
            {isEdit && (
              <p className="text-xs text-slate-400">
                Transaksi lama yang memakai sumber dana ini otomatis ikut berganti ke nama baru.
              </p>
            )}
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-fund-source-btn"
            className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            {isEdit ? "Simpan Perubahan" : "Tambah Sumber Dana"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FundSourceSettings() {
  const [fundSources, setFundSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/fund-sources")
      .then((r) => setFundSources(r.data.fund_sources))
      .catch(() => toast.error("Gagal memuat sumber dana"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (fs) => { setEditing(fs); setDialogOpen(true); };

  const remove = async (fs) => {
    if (fs.usage_count > 0) {
      toast.error(
        `Sumber dana "${fs.name}" masih dipakai ${fs.usage_count} transaksi. ` +
        "Ubah sumber dana transaksinya dulu sebelum menghapus."
      );
      return;
    }
    if (!window.confirm(`Hapus sumber dana "${fs.name}"?`)) return;
    try {
      await api.delete(`/fund-sources/${fs.id}`);
      toast.success("Sumber dana dihapus");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus sumber dana");
    }
  };

  // Icon based on name
  const getIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes("bca") || n.includes("mandiri") || n.includes("bni") || n.includes("bri") || n.includes("bank")) return <Landmark className="h-3.5 w-3.5 text-emerald-600" />;
    if (n.includes("cash") || n.includes("tunai")) return <Wallet className="h-3.5 w-3.5 text-amber-600" />;
    if (n.includes("dana") || n.includes("gopay") || n.includes("ovo") || n.includes("shopeepay") || n.includes("ewallet") || n.includes("e-wallet")) return <CreditCard className="h-3.5 w-3.5 text-blue-600" />;
    return <Building2 className="h-3.5 w-3.5 text-slate-500" />;
  };

  return (
    <div className="space-y-4" data-testid="fund-source-settings">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          Atur sumber dana / bank yang muncul saat mencatat transaksi (pemasukan, pengeluaran, mutasi).
        </p>
        <Button data-testid="add-fund-source-btn" onClick={openAdd}
          className="rounded-lg active:scale-95 transition-transform duration-150">
          <Plus className="h-4 w-4 mr-1.5" /> Tambah Sumber Dana
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="fund-sources-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Sumber Dana / Bank</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Dipakai</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>}
            {!loading && fundSources.length === 0 && (
              <tr><td colSpan={3} className="p-6 text-center text-slate-400 text-sm">Belum ada sumber dana.</td></tr>
            )}
            {!loading && fundSources.map((fs) => (
              <tr key={fs.id} data-testid={`fund-source-row-${fs.id}`}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
                <td className="p-3 font-medium text-slate-800 flex items-center gap-2">
                  {getIcon(fs.name)}
                  {fs.name}
                </td>
                <td className="p-3 text-slate-500">{fs.usage_count} transaksi</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(fs)} data-testid={`edit-fund-source-btn-${fs.id}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors duration-150">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(fs)} data-testid={`delete-fund-source-btn-${fs.id}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Sumber dana yang sudah dipakai transaksi tidak bisa dihapus, tetapi bisa diganti nama.
      </p>

      <FundSourceDialog open={dialogOpen} onOpenChange={setDialogOpen} fundSource={editing} onSaved={load} />
    </div>
  );
}