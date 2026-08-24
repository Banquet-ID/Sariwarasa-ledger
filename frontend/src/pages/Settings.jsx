import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

function AddUserDialog({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "team" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", email: "", password: "", role: "team" });
  }, [open]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post("/users", form);
      toast.success(`User ${form.email} berhasil dibuat`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal membuat user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-user-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">Tambah User Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="cth: Rani" data-testid="user-name-input" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="nama@sariwarasa.com" data-testid="user-email-input" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Minimal 6 karakter" data-testid="user-password-input" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Team — view only</SelectItem>
                <SelectItem value="owner">Owner — full access</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400">User dengan email ini juga bisa login via Google dengan role yang sama.</p>
          </div>
          <Button onClick={submit} disabled={saving} data-testid="save-user-btn"
            className="w-full rounded-lg active:scale-95 transition-transform duration-150">
            Simpan User
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const { user, isOwner } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(() => {
    if (!isOwner) { setLoading(false); return; }
    setLoading(true);
    api.get("/users")
      .then((r) => setUsers(r.data.users))
      .catch(() => toast.error("Gagal memuat daftar user"))
      .finally(() => setLoading(false));
  }, [isOwner]);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (u, role) => {
    try {
      await api.put(`/users/${u.user_id}/role`, { role });
      toast.success(`Role ${u.email} diubah menjadi ${role}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal mengubah role");
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Hapus user ${u.email}? Sesi login-nya juga akan dicabut.`)) return;
    try {
      await api.delete(`/users/${u.user_id}`);
      toast.success("User dihapus");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menghapus user");
    }
  };

  if (!isOwner) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center" data-testid="settings-forbidden">
        <ShieldAlert className="h-8 w-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">Halaman ini hanya untuk owner.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="settings-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Pengaturan</h1>
          <p className="text-sm text-slate-500 mt-0.5">Kelola user dan role akses.</p>
        </div>
        <Button data-testid="add-user-btn" onClick={() => setAddOpen(true)}
          className="rounded-lg active:scale-95 transition-transform duration-150">
          <UserPlus className="h-4 w-4 mr-1.5" /> Tambah User
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="users-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Nama</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Email</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Role</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Dibuat</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>}
            {!loading && users.map((u) => {
              const isSelf = u.user_id === user?.user_id;
              return (
                <tr key={u.user_id} data-testid={`user-row-${u.user_id}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
                  <td className="p-3 font-medium text-slate-800">
                    {u.name} {isSelf && <span className="text-xs text-slate-400">(Anda)</span>}
                  </td>
                  <td className="p-3 text-slate-600">{u.email}</td>
                  <td className="p-3">
                    {isSelf ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50" data-testid={`role-badge-${u.user_id}`}>
                        Owner
                      </Badge>
                    ) : (
                      <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
                        <SelectTrigger className="w-44 h-8" data-testid={`role-select-${u.user_id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team" data-testid={`role-option-team-${u.user_id}`}>Team — view only</SelectItem>
                          <SelectItem value="owner" data-testid={`role-option-owner-${u.user_id}`}>Owner — full access</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="p-3 text-slate-500 whitespace-nowrap">{formatDate(u.created_at)}</td>
                  <td className="p-3 text-right">
                    {!isSelf && (
                      <button onClick={() => deleteUser(u)} data-testid={`delete-user-btn-${u.user_id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Akun Google: email yang login via Google otomatis mendapat role <span className="font-semibold">owner</span> jika terdaftar sebagai owner di sini, selain itu <span className="font-semibold">team</span>.
      </p>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onSaved={load} />
    </div>
  );
}
