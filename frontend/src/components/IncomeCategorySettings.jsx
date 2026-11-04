import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Lock, FolderOpen } from "lucide-react";
import { toast } from "sonner";

// Dialog for add/edit income category
function CategoryDialog({ open, onOpenChange, category, onSaved }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("Revenue");
  const [saving, setSaving] = useState(false);
  const isEdit = !!category;

  useEffect(() => {
    if (open) {
      setName(category?.name || "");
      setGroup(category?.group || "Revenue");
    }
  }, [open, category]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Nama kategori wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/income-categories/${category.id}`, { name, group });
        toast.success("Kategori diperbarui");
      } else {
        await api.post("/income-categories", { name, group });
        toast.success("Kategori ditambahkan");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan kategori");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="income-category-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit Kategori Pemasukan" : "Tambah Kategori Pemasukan"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama kategori</Label>
            <Input
              value={name} maxLength={50} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="cth: Sponsor Event" data-testid="income-category-name-input"
            />
            {isEdit && (
              <p className="text-xs text-slate-400">
                Transaksi lama yang memakai kategori ini otomatis ikut berganti ke nama baru.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Grup</Label>
            <Select value={group} onValueChange={(v) => setGroup(v)}>
              <SelectTrigger data-testid="income-category-group-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Revenue">Revenue</SelectItem>
                <SelectItem value="Non-revenue">Non-revenue</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400">
              Revenue = pendapatan utama (Events, Catering, dll). Non-revenue = pendapatan lain (Piutang, Other).
            </p>
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-income-category-btn"
            className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            {isEdit ? "Simpan Perubahan" : "Tambah Kategori"}
          </Button>
        </div>      </DialogContent>
    </Dialog>
  );
}

export default function IncomeCategorySettings() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/income-categories")
      .then((r) => setCategories(r.data.categories))
      .catch(() => toast.error("Gagal memuat kategori pemasukan"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c) => { setEditing(c); setDialogOpen(true); };

  const remove = async (c) => {
    if (c.usage_count > 0) {
      toast.error(
        `Kategori "${c.name}" masih dipakai ${c.usage_count} transaksi. ` +
        "Ubah kategori transaksinya dulu, atau cukup ganti nama kategori ini."
      );
      return;
    }
    if (!window.confirm(`Hapus kategori "${c.name}"?`)) return;
    try {
      await api.delete(`/income-categories/${c.id}`);
      toast.success("Kategori dihapus");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus kategori");
    }
  };

  return (
    <div className="space-y-4" data-testid="income-category-settings">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          Atur kategori yang muncul saat mencatat pemasukan. Dikelompokkan per grup Revenue / Non-revenue.
        </p>
        <Button data-testid="add-income-category-btn" onClick={openAdd}
          className="rounded-lg active:scale-95 transition-transform duration-150">
          <Plus className="h-4 w-4 mr-1.5" /> Tambah Kategori
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="income-categories-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Kategori</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Grup</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Dipakai</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>}
            {!loading && categories.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-slate-400 text-sm">Belum ada kategori.</td></tr>
            )}
            {!loading && categories.map((c) => (
              <tr key={c.id} data-testid={`income-category-row-${c.id}`}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
                <td className="p-3 font-medium text-slate-800">
                  {c.name}
                  {c.protected && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-slate-400"
                      title="Dipakai oleh sistem, tidak bisa diubah atau dihapus">
                      <Lock className="h-3 w-3" /> Sistem
                    </span>
                  )}
                </td>
                <td className="p-3 text-slate-600">
                  <span className={c.group === "Revenue" 
                    ? "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700"
                    : "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-cyan-50 text-cyan-700"
                  }>
                    {c.group === "Revenue" ? <FolderOpen className="h-3 w-3" /> : <FolderOpen className="h-3 w-3" />}
                    {c.group}
                  </span>
                </td>
                <td className="p-3 text-slate-500">{c.usage_count} transaksi</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {!c.protected && (
                    <>
                      <button onClick={() => openEdit(c)} data-testid={`edit-income-category-btn-${c.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors duration-150">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(c)} data-testid={`delete-income-category-btn-${c.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Kategori yang sudah dipakai transaksi tidak bisa dihapus, tetapi bisa diganti nama atau pindah grup.
        Kategori sistem (Pembayaran Piutang, Other) dilindungi dan tidak bisa diubah.
      </p>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} onSaved={load} />
    </div>
  );
}