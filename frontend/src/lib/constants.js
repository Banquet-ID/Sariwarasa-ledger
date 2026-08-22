export const FUND_SOURCES = ["Cash", "BCA 1", "BCA 2", "Mandiri", "BNI", "Other"];

export const INCOME_GROUPS = [
  { group: "Revenue", categories: ["Events", "Catering"] },
  { group: "Non-revenue", categories: ["Pembayaran Piutang", "Other"] },
];

export const EXPENSE_CATEGORIES = [
  "Buah", "Guest Supplies", "Cup", "Transportasi", "Sewa Tempat",
  "Operational Event", "Marketing", "Printing", "Bayar Hutang", "Akomodasi", "Lainnya",
];

export const REVENUE_CATEGORIES = ["Events", "Catering"];

export function txKind(t) {
  if (t.type === "transfer") return "transfer";
  if (t.type === "income") return REVENUE_CATEGORIES.includes(t.category) ? "revenue" : "non_revenue";
  return "expense";
}

export const KIND_META = {
  revenue: { label: "Revenue", badge: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  non_revenue: { label: "Non-Revenue", badge: "bg-cyan-100 text-cyan-800 border border-cyan-200" },
  expense: { label: "Pengeluaran", badge: "bg-rose-100 text-rose-800 border border-rose-200" },
  transfer: { label: "Mutasi Internal", badge: "bg-slate-100 text-slate-700 border border-slate-300" },
};

export function amountColor(t) {
  if (t.type === "income") return "text-emerald-700";
  if (t.type === "expense") return "text-rose-700";
  return "text-slate-600";
}
