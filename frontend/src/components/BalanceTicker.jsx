import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import api from "@/lib/api";
import { formatIDR } from "@/lib/format";
import { Landmark } from "lucide-react";

export default function BalanceTicker() {
  const [data, setData] = useState(null);
  const location = useLocation();

  const load = useCallback(() => {
    api.get("/balances").then((r) => setData(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("sw:refresh", handler);
    return () => window.removeEventListener("sw:refresh", handler);
  }, [load, location.pathname]);

  if (!data) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1" data-testid="balance-ticker-loading">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 w-40 shrink-0 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-1" data-testid="balance-ticker">
      {data.balances.map((b) => (
        <div
          key={b.name}
          data-testid={`balance-card-${b.name.toLowerCase().replace(/\s+/g, "-")}`}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm min-w-[150px]"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Landmark className="h-3 w-3" />
            {b.name}
          </div>
          <div className={`font-mono text-sm font-semibold tracking-tight mt-0.5 ${b.balance < 0 ? "text-rose-600" : "text-slate-900"}`}>
            {formatIDR(b.balance)}
          </div>
        </div>
      ))}
      <div className="shrink-0 rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 shadow-sm min-w-[150px]" data-testid="balance-card-total">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total</div>
        <div className="font-mono text-sm font-semibold tracking-tight mt-0.5 text-white">
          {formatIDR(data.total)}
        </div>
      </div>
    </div>
  );
}
