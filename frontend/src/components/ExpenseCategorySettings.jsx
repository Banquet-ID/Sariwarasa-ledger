import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";

// Dialog dipakai untuk tambah (category = null) maupun edit (category = objek kategori).
function CategoryDialog({ open, onOpenChange, category, onSaved }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = !!category;

  useEffect(() => {
    if (open) setName(category?.name || "");
  }, [open, category]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Nama kategori wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/expense-categories/${category.id}`, { name });
        toast.success("Kategori diperbarui");
      } else {
        await api.post("/expense-categories", { name });
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
      <DialogContent data-testid="category-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? "Edit Kategori Pengeluaran" : "Tambah Kategori Pengeluaran"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama kategori</Label>
            <Input
              value={name} maxLength={50} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="cth: Listrik & Air" data-testid="category-name-input"
            />
            {isEdit && (
              <p className="text-xs text-slate-400">
                Transaksi lama yang memakai kategori ini otomatis ikut berganti ke nama baru.
              </p>
            )}
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-category-btn"
            className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            {isEdit ? "Simpan Perubahan" : "Tambah Kategori"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseCategorySettings() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/expense-categories")
      .then((r) => setCategories(r.data.categories))
      .catch(() => toast.error("Gagal memuat kategori pengeluaran"))
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
      await api.delete(`/expense-categories/${c.id}`);
      toast.success("Kategori dihapus");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus kategori");
    }
  };

  return (
    <div className="space-y-4" data-testid="expense-category-settings">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          Atur kategori yang muncul saat mencatat pengeluaran.
        </p>
        <Button data-testid="add-category-btn" onClick={openAdd}
          className="rounded-lg active:scale-95 transition-transform duration-150">
          <Plus className="h-4 w-4 mr-1.5" /> Tambah Kategori
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="categories-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Kategori</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Dipakai</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>}
            {!loading && categories.length === 0 && (
              <tr><td colSpan={3} className="p-6 text-center text-slate-400 text-sm">Belum ada kategori.</td></tr>
            )}
            {!loading && categories.map((c) => (
              <tr key={c.id} data-testid={`category-row-${c.id}`}
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
                <td className="p-3 text-slate-500">{c.usage_count} transaksi</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {!c.protected && (
                    <>
                      <button onClick={() => openEdit(c)} data-testid={`edit-category-btn-${c.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors duration-150">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(c)} data-testid={`delete-category-btn-${c.id}`}
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
        Kategori yang sudah dipakai transaksi tidak bisa dihapus, tetapi bisa diganti namanya.
      </p>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} onSaved={load} />
    </div>
  );
}
