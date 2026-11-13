import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { formatIDR, formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { Scale, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

function localDate(date) {
  const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,"0"), d=String(date.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+d;
}
export default function Reports() {
  const { isOwner } = useAuth();
  const [startDate,setStartDate]=useState(()=>localDate(new Date(new Date().getFullYear(),new Date().getMonth(),1)));
  const [endDate,setEndDate]=useState(()=>localDate(new Date()));
  const [report,setReport]=useState(null);
  const [logs,setLogs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [exporting,setExporting]=useState("");

  const load=useCallback(()=>{
    if(!startDate||!endDate||startDate>endDate) return;
    setLoading(true);
    api.get("/reports/period",{params:{start_date:startDate,end_date:endDate}})
      .then(r=>setReport(r.data))
      .catch(e=>toast.error(e.response?.data?.detail||"Gagal memuat laporan"))
      .finally(()=>setLoading(false));
    if(isOwner) api.get("/audit-logs").then(r=>setLogs(r.data.logs)).catch(()=>{});
  },[startDate,endDate,isOwner]);
  useEffect(()=>{load();},[load]);

  const download=async(format)=>{
    if(!startDate||!endDate||startDate>endDate){toast.error("Periksa tanggal mulai dan akhir");return;}
    setExporting(format);
    try{
      const response=await api.get("/reports/export",{params:{start_date:startDate,end_date:endDate,format},responseType:"blob"});
      const blob=new Blob([response.data],{type:format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const url=window.URL.createObjectURL(blob), link=document.createElement("a");
      link.href=url;link.download="sariwarasa-report-"+startDate+"-to-"+endDate+"."+format;
      document.body.appendChild(link);link.click();link.remove();window.URL.revokeObjectURL(url);
      toast.success("Laporan berhasil diunduh");
    }catch(e){toast.error("Gagal membuat file laporan");}
    finally{setExporting("");}
  };
  const openDebts=(report?.debts||[]).filter(d=>d.remaining>0);
  return <div className="space-y-6" data-testid="reports-page">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div><h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Laporan</h1>
        <p className="text-sm text-slate-500 mt-0.5">Arus kas, laba rugi, saldo dan posisi hutang-piutang berdasarkan periode.</p></div>
      <div className="flex items-end gap-2 flex-wrap">
        <div><label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1">Mulai</label>
          <Input type="date" value={startDate} max={endDate||undefined} onChange={e=>setStartDate(e.target.value)} className="w-40" data-testid="report-start-date"/></div>
        <div><label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-1">Akhir</label>
          <Input type="date" value={endDate} min={startDate||undefined} onChange={e=>setEndDate(e.target.value)} className="w-40" data-testid="report-end-date"/></div>
        <Button variant="outline" onClick={()=>download("pdf")} disabled={loading||!!exporting||!report}>
          <FileText className="h-4 w-4 mr-2"/>{exporting==="pdf"?"Membuat PDF...":"PDF"}</Button>
        <Button onClick={()=>download("xlsx")} disabled={loading||!!exporting||!report}>
          <FileSpreadsheet className="h-4 w-4 mr-2"/>{exporting==="xlsx"?"Membuat Excel...":"Excel"}</Button>
      </div>
    </div>
    {loading&&<p className="text-sm text-slate-500">Memuat laporan...</p>}
    {!loading&&report&&<>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="pnl-card">
        <div className="flex items-center gap-2 mb-4"><Scale className="h-4 w-4 text-slate-500"/>
          <h3 className="font-heading text-lg font-medium text-slate-800">Ringkasan {startDate} — {endDate}</h3></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div><div className="text-xs font-bold uppercase tracking-wider text-emerald-600">Revenue</div><div className="font-mono text-lg font-semibold text-emerald-700 mt-1">{formatIDR(report.revenue)}</div></div>
          <div><div className="text-xs font-bold uppercase tracking-wider text-cyan-600">Non-Revenue</div><div className="font-mono text-lg font-semibold text-cyan-700 mt-1">{formatIDR(report.non_revenue)}</div></div>
          <div><div className="text-xs font-bold uppercase tracking-wider text-rose-600">Total Pengeluaran</div><div className="font-mono text-lg font-semibold text-rose-700 mt-1">{formatIDR(report.total_expense)}</div></div>
          <div><div className="text-xs font-bold uppercase tracking-wider text-slate-600">Laba Bersih</div><div className={"font-mono text-lg font-semibold mt-1 "+(report.net_profit>=0?"text-emerald-700":"text-rose-700")}>{formatIDR(report.net_profit)}</div></div>
        </div>
        {report.expense_by_category.length>0&&<div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Pengeluaran per Kategori</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5">
            {report.expense_by_category.map(c=><div key={c.category} className="flex justify-between text-sm py-1 border-b border-slate-50"><span className="text-slate-600">{c.category}</span><span className="font-mono font-medium text-rose-700">{formatIDR(c.total)}</span></div>)}</div></div>}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-cashflow-card">
        <h3 className="font-heading text-lg font-medium text-slate-800 mb-4">Arus Kas Bulanan dalam Periode</h3>
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.cashflow} margin={{top:4,right:8,left:8,bottom:0}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false}/><XAxis dataKey="month" tick={{fontSize:11,fill:"#64748b"}} tickLine={false} axisLine={false}/>
          <YAxis tick={{fontSize:11,fill:"#64748b",fontFamily:"JetBrains Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1e6?(v/1e6).toFixed(0)+"jt":v>=1e3?(v/1e3).toFixed(0)+"rb":v}/>
          <Tooltip formatter={(v,n)=>[formatIDR(v),n==="income"?"Pemasukan":"Pengeluaran"]}/><Legend formatter={v=>v==="income"?"Pemasukan":"Pengeluaran"}/>
          <Bar dataKey="income" fill="#059669" radius={[4,4,0,0]}/><Bar dataKey="expense" fill="#e11d48" radius={[4,4,0,0]}/>
        </BarChart></ResponsiveContainer></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-balance-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Saldo per Sumber Dana</h3>
          <p className="text-xs text-slate-500 mb-2">Saldo awal, mutasi, dan saldo akhir periode.</p>
          <table className="w-full text-sm"><thead><tr className="text-xs text-slate-500"><th className="text-left py-2">Sumber Dana</th><th className="text-right">Saldo Awal</th><th className="text-right">Saldo Akhir</th></tr></thead><tbody>
            {report.balances.map(b=><tr key={b.name} className="border-b border-slate-50"><td className="py-2 text-slate-600">{b.name}</td><td className="py-2 text-right font-mono">{formatIDR(b.opening)}</td><td className={"py-2 text-right font-mono font-semibold "+(b.closing<0?"text-rose-600":"text-slate-900")}>{formatIDR(b.closing)}</td></tr>)}
            <tr className="border-t border-slate-200 font-bold"><td className="py-2">Total</td><td className="text-right">{formatIDR(report.balance_total_opening)}</td><td className="text-right">{formatIDR(report.balance_total_closing)}</td></tr>
          </tbody></table>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="report-debts-card">
          <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Hutang & Piutang Outstanding per Akhir Periode</h3>
          {openDebts.length===0&&<p className="text-sm text-slate-400">Tidak ada yang outstanding.</p>}
          <div className="space-y-1.5">{openDebts.map(d=><div key={d.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50 last:border-0">
            <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded "+(d.type==="hutang"?"bg-red-100 text-red-800":"bg-indigo-100 text-indigo-800")}>{d.type==="hutang"?"Hutang":"Piutang"}</span>
            <span className="text-slate-700 truncate flex-1">{d.party}</span><span className="font-mono font-semibold text-slate-900">{formatIDR(d.remaining)}</span>
          </div>)}</div>
        </div>
      </div>
    </>}
    {isOwner&&logs.length>0&&<div className="rounded-lg border border-slate-200 bg-white shadow-sm p-5" data-testid="audit-log-card">
      <h3 className="font-heading text-lg font-medium text-slate-800 mb-3">Audit Log</h3><div className="space-y-1 max-h-72 overflow-y-auto">
        {logs.map(l=><div key={l.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-slate-50 last:border-0">
          <span className="text-slate-400 whitespace-nowrap font-mono">{formatDate(l.created_at)}</span><span className="text-slate-500 whitespace-nowrap">{l.email}</span>
          <span className="font-bold text-slate-700 uppercase text-[10px]">{l.action}</span><span className="text-slate-600 truncate">{l.detail}</span>
        </div>)}</div></div>}
  </div>;
}
