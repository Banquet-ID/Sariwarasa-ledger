import { useEffect, useMemo, useState } from "react";
import api, { fileUrl } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FUND_SOURCES, INCOME_GROUPS, EXPENSE_CATEGORIES } from "@/lib/constants";
import { todayStr } from "@/lib/format";
import { toast } from "sonner";
import { Sparkles, Loader2, AlertTriangle, Paperclip, ImageIcon } from "lucide-react";

const EMPTY = {
  type: "income", amount: "", date: todayStr(), category: "", fund_source: "",
  to_fund_source: "", notes: "", event_name: "", event_location: "", event_pic: "",
  attachment_path: "",
};

export default function TransactionDrawer({ open, onOpenChange, onSaved, editTx, preset }) {
  const [form, setForm] = useState(EMPTY);
  const [draftId, setDraftId] = useState(null);
  const [aiInfo, setAiInfo] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAiInfo(null);
    if (editTx) {
      setDraftId(editTx.source === "ai" && editTx.status === "draft" ? editTx.id : null);
      setAiInfo(editTx.ai_extraction || null);
      setForm({
        type: editTx.type === "unknown" ? "income" : editTx.type,
        amount: editTx.amount || "",
        date: editTx.date || todayStr(),
        category: editTx.category || "",
        fund_source: editTx.fund_source || "",
        to_fund_source: editTx.to_fund_source || "",
        notes: editTx.notes || "",
        event_name: editTx.event_name || "",
        event_location: editTx.event_location || "",
        event_pic: editTx.event_pic || "",
        attachment_path: editTx.attachment_path || "",
      });
    } else {
      setDraftId(null);
      setForm({ ...EMPTY, date: todayStr(), ...(preset || {}) });
    }
  }, [open, editTx, preset]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isDraftContext = !!draftId || editTx?.status === "draft";

  const handleAiUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAiLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/ai/extract", fd);
      const d = r.data.draft;
      setDraftId(d.id);
      setAiInfo(r.data.extraction);
      setForm((f) => ({
        ...f,
        type: d.type !== "unknown" ? d.type : f.type,
        amount: d.amount || "",
        date: d.date || f.date,
        category: d.category || "",
        fund_source: d.fund_source || "",
        notes: d.notes || "",
        attachment_path: d.attachment_path || "",
      }));
      toast.success("AI selesai membaca gambar — periksa draft sebelum simpan");
    } catch (err) {
      toast.error(err.response?.data?.detail || "AI gagal membaca gambar");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAttachment = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/files/upload", fd);
      set("attachment_path", r.data.path);
      toast.success("Lampiran terunggah");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal mengunggah lampiran");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    const payload = {
      type: form.type,
      amount: parseFloat(form.amount) || 0,
      date: form.date,
      category: form.type === "transfer" ? null : form.category || null,
      fund_source: form.fund_source || null,
      to_fund_source: form.type === "transfer" ? form.to_fund_source || null : null,
      notes: form.notes,
      event_name: form.event_name || null,
      event_location: form.event_location || null,
      event_pic: form.event_pic || null,
      attachment_path: form.attachment_path || null,
      status: isDraftContext ? "final" : editTx ? editTx.status : "final",
    };
    try {
      if (draftId || editTx) {
        await api.put(`/transactions/${draftId || editTx.id}`, payload);
      } else {
        const r = await api.post("/transactions", payload);
        if (r.data.duplicate_warning) {
          toast.warning("Kemungkinan duplikat: ada transaksi dengan jenis, nominal, dan tanggal yang sama");
        }
      }
      toast.success(isDraftContext ? "Draft disimpan sebagai final" : "Transaksi tersimpan");
      window.dispatchEvent(new Event("sw:refresh"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan transaksi");
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = useMemo(() => {
    if (form.type === "income") return INCOME_GROUPS;
    if (form.type === "expense") return [{ group: "Pengeluaran", categories: EXPENSE_CATEGORIES }];
    return [];
  }, [form.type]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto p-6" data-testid="transaction-drawer">
        <SheetHeader className="mb-5">
          <SheetTitle className="font-heading text-xl tracking-tight">
            {editTx ? (isDraftContext ? "Review Draft AI" : "Edit Transaksi") : "Tambah Transaksi"}
          </SheetTitle>
        </SheetHeader>

        {!editTx && (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 mb-5" data-testid="ai-upload-section">
            <div className="flex items-center gap-2 text-amber-900 text-sm font-semibold mb-1">
              <Sparkles className="h-4 w-4" />
              Input cepat via AI
            </div>
            <p className="text-xs text-amber-800/80 mb-3">
              Upload nota, screenshot mutasi bank, invoice, atau foto catatan. AI membuat draft — Anda review sebelum final.
            </p>
            <label className="inline-flex">
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAiUpload} data-testid="ai-image-input" />
              <span className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-amber-950 cursor-pointer hover:bg-amber-500 active:scale-95 transition-all duration-150">
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {aiLoading ? "AI sedang membaca..." : "Upload Gambar"}
              </span>
            </label>
          </div>
        )}

        {isDraftContext && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-5 flex items-start gap-2" data-testid="draft-banner">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-bold text-amber-900">DRAFT — Belum Final</div>
              <p className="text-xs text-amber-800/80 mt-0.5">
                Periksa data hasil bacaan AI terhadap gambar, koreksi jika perlu, lalu simpan final.
                {aiInfo?.confidence && ` Confidence AI: ${aiInfo.confidence}.`}
              </p>
              {aiInfo?.warnings?.length > 0 && (
                <ul className="text-xs text-amber-800 mt-1 list-disc pl-4">
                  {aiInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {aiLoading && (
          <div className="space-y-3 mb-5" data-testid="ai-loading-skeleton">
            {[...Array(4)].map((_, i) => <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        )}

        <div className="space-y-5">
          <Tabs value={form.type} onValueChange={(v) => set("type", v)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="income" data-testid="tab-income" className="data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800">Pemasukan</TabsTrigger>
              <TabsTrigger value="expense" data-testid="tab-expense" className="data-[state=active]:bg-rose-100 data-[state=active]:text-rose-800">Pengeluaran</TabsTrigger>
              <TabsTrigger value="transfer" data-testid="tab-transfer" className="data-[state=active]:bg-slate-200 data-[state=active]:text-slate-800">Mutasi</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nominal (Rp)</Label>
              <Input
                type="number" min="0" value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0" className="font-mono" data-testid="tx-amount-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} data-testid="tx-date-input" />
            </div>
          </div>

          {form.type !== "transfer" && (
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Select value={form.category || undefined} onValueChange={(v) => set("category", v)}>
                <SelectTrigger data-testid="tx-category-select">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{g.group}</SelectLabel>
                      {g.categories.map((c) => (
                        <SelectItem key={c} value={c} data-testid={`category-option-${c.toLowerCase().replace(/\s+/g, "-")}`}>{c}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {(form.category === "Other" || form.category === "Lainnya") && (
                <p className="text-xs text-amber-700 font-medium">Kategori ini wajib mengisi catatan penjelasan.</p>
              )}
            </div>
          )}

          {form.category === "Events" && form.type === "income" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-4" data-testid="event-fields">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Detail Event (wajib)</div>
              <div className="space-y-1.5">
                <Label>Nama Event</Label>
                <Input value={form.event_name} onChange={(e) => set("event_name", e.target.value)} placeholder="cth: Wedding Budi & Ani" data-testid="tx-event-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Lokasi</Label>
                  <Input value={form.event_location} onChange={(e) => set("event_location", e.target.value)} placeholder="cth: Gedung Serbaguna X" data-testid="tx-event-location-input" />
                </div>
                <div className="space-y-1.5">
                  <Label>PIC</Label>
                  <Input value={form.event_pic} onChange={(e) => set("event_pic", e.target.value)} placeholder="cth: Rani" data-testid="tx-event-pic-input" />
                </div>
              </div>
            </div>
          )}

          <div className={`grid gap-4 ${form.type === "transfer" ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="space-y-1.5">
              <Label>{form.type === "transfer" ? "Dari Sumber Dana" : "Sumber Dana"}</Label>
              <Select value={form.fund_source || undefined} onValueChange={(v) => set("fund_source", v)}>
                <SelectTrigger data-testid="tx-fund-source-select">
                  <SelectValue placeholder="Pilih sumber dana" />
                </SelectTrigger>
                <SelectContent>
                  {FUND_SOURCES.map((fs) => <SelectItem key={fs} value={fs}>{fs}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.type === "transfer" && (
              <div className="space-y-1.5">
                <Label>Ke Sumber Dana</Label>
                <Select value={form.to_fund_source || undefined} onValueChange={(v) => set("to_fund_source", v)}>
                  <SelectTrigger data-testid="tx-to-fund-source-select">
                    <SelectValue placeholder="Pilih tujuan" />
                  </SelectTrigger>
                  <SelectContent>
                    {FUND_SOURCES.filter((fs) => fs !== form.fund_source).map((fs) => (
                      <SelectItem key={fs} value={fs}>{fs}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Catatan tambahan..." rows={2} data-testid="tx-notes-input" />
          </div>

          <div className="space-y-2">
            <Label>Lampiran Bukti</Label>
            {form.attachment_path ? (
              <div className="rounded-lg border border-slate-200 p-2" data-testid="attachment-preview">
                {/\.(jpg|jpeg|png|webp)$/i.test(form.attachment_path) ? (
                  <img src={fileUrl(form.attachment_path)} alt="Bukti" className="max-h-48 rounded-md object-contain mx-auto" />
                ) : (
                  <a href={fileUrl(form.attachment_path)} target="_blank" rel="noreferrer" className="text-sm text-slate-700 underline flex items-center gap-2">
                    <Paperclip className="h-4 w-4" /> Lihat lampiran
                  </a>
                )}
                <button onClick={() => set("attachment_path", "")} className="text-xs text-rose-600 font-medium mt-2 hover:underline" data-testid="remove-attachment-btn">
                  Hapus lampiran
                </button>
              </div>
            ) : (
              <label className="inline-flex">
                <input type="file" className="hidden" onChange={handleAttachment} data-testid="attachment-input" />
                <span className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 active:scale-95 transition-all duration-150">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                  {uploading ? "Mengunggah..." : "Upload bukti"}
                </span>
              </label>
            )}
          </div>

          <Button
            onClick={submit}
            disabled={saving || aiLoading}
            data-testid="save-transaction-btn"
            className={`w-full rounded-lg active:scale-95 transition-transform duration-150 ${isDraftContext ? "bg-amber-500 hover:bg-amber-600 text-amber-950 font-bold" : ""}`}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isDraftContext ? "Simpan Final" : "Simpan"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
