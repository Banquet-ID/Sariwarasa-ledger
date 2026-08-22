import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { formatIDR, formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import TransactionDrawer from "@/components/TransactionDrawer";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, MapPin, User } from "lucide-react";
import { toast } from "sonner";

export default function Events() {
  const { isOwner } = useAuth();
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTx, setEditTx] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/events")
      .then((r) => { setEvents(r.data.events); setTotal(r.data.total); })
      .catch(() => toast.error("Gagal memuat data event"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5" data-testid="events-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Revenue Event</h1>
          <p className="text-sm text-slate-500 mt-0.5">Rekap pemasukan per event.</p>
        </div>
        {isOwner && (
          <Button
            data-testid="add-event-btn"
            onClick={() => { setEditTx(null); setDrawerOpen(true); }}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-transform duration-150"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Tambah Revenue Event
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5" data-testid="events-total-card">
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Revenue Event</div>
        <div className="font-mono text-2xl font-semibold tracking-tight text-emerald-900 mt-1">{formatIDR(total)}</div>
        <div className="text-xs text-emerald-700 mt-0.5">{events.length} event tercatat</div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="events-table">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Event</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Tanggal</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Lokasi</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">PIC</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500">Sumber Dana</th>
              <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Total</th>
              {isOwner && <th className="p-3 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-slate-400 text-sm">Memuat...</td></tr>}
            {!loading && events.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400 text-sm" data-testid="events-empty">Belum ada revenue event.</td></tr>
            )}
            {!loading && events.map((e) => (
              <tr key={e.id} data-testid={`event-row-${e.id}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
                <td className="p-3">
                  <div className="font-medium text-slate-800">{e.event_name}</div>
                  {e.notes && <div className="text-xs text-slate-400 truncate max-w-[200px]">{e.notes}</div>}
                </td>
                <td className="p-3 text-slate-600 whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="p-3 text-slate-600">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{e.event_location}</span>
                </td>
                <td className="p-3 text-slate-600">
                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-slate-400" />{e.event_pic}</span>
                </td>
                <td className="p-3 text-slate-600">{e.fund_source}</td>
                <td className="p-3 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">+{formatIDR(e.amount)}</td>
                {isOwner && (
                  <td className="p-3 text-right">
                    <button
                      onClick={() => { setEditTx(e); setDrawerOpen(true); }}
                      data-testid={`edit-event-btn-${e.id}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-150"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TransactionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSaved={load}
        editTx={editTx}
        preset={editTx ? undefined : { type: "income", category: "Events" }}
      />
    </div>
  );
}
