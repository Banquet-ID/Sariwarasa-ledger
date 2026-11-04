// constants.js - Master data constants with API sync capability
// Hardcoded values serve as fallbacks; runtime data comes from /api/meta

export const FUND_SOURCES = ["Cash", "BCA 1", "BCA 2", "Mandiri", "BNI", "Other"];

export const INCOME_GROUPS = [
  { group: "Revenue", categories: ["Events", "Catering"] },
  { group: "Non-revenue", categories: ["Pembayaran Piutang", "Other"] },
];

// Fallback only. Runtime categories come from API /expense-categories
export const EXPENSE_CATEGORIES = [
  "Buah", "Guest Supplies", "Cup", "Transportasi", "Sewa Tempat",
  "Operational Event", "Marketing", "Printing", "Bayar Hutang", "Akomodasi", "Lainnya",
];

// Fallback only. Runtime categories come from API /income-categories
export const REVENUE_CATEGORIES = ["Events", "Catering"];

// Protected categories that cannot be deleted/renamed (system logic depends on them)
export const PROTECTED_EXPENSE_CATEGORIES = new Set(["Bayar Hutang", "Lainnya"]);
export const PROTECTED_INCOME_CATEGORIES = new Set(["Pembayaran Piutang", "Other"]);
export const NOTE_REQUIRED_CATEGORIES = new Set(["Other", "Lainnya"]);


// ---------- Dynamic data fetching from API ----------
import api from "@/lib/api";

let _dynamicFundSources = null;
let _dynamicIncomeGroups = null;
let _dynamicExpenseCategories = null;
let _metaLoaded = false;

// force=true mengambil ulang dari server (dipakai saat form dibuka agar perubahan di Pengaturan ikut terbaca).
export async function loadMeta(force = false) {
  if (_metaLoaded && !force) return;
  try {
    const res = await api.get("/meta");
    _dynamicFundSources = res.data.fund_sources || FUND_SOURCES;
    _dynamicIncomeGroups = res.data.income_groups || INCOME_GROUPS;
    _dynamicExpenseCategories = res.data.expense_categories || EXPENSE_CATEGORIES;
    _metaLoaded = true;
  } catch (e) {
    console.warn("Failed to load meta from API, using fallbacks:", e);
    _dynamicFundSources = FUND_SOURCES;
    _dynamicIncomeGroups = INCOME_GROUPS;
    _dynamicExpenseCategories = EXPENSE_CATEGORIES;
    _metaLoaded = true;
  }
}

export function getFundSources() {
  return _dynamicFundSources || FUND_SOURCES;
}

export function getIncomeGroups() {
  return _dynamicIncomeGroups || INCOME_GROUPS;
}

export function getExpenseCategories() {
  return _dynamicExpenseCategories || EXPENSE_CATEGORIES;
}

export function getRevenueCategories() {
  const groups = getIncomeGroups();
  const revenueGroup = groups.find(g => g.group === "Revenue");
  return revenueGroup?.categories || REVENUE_CATEGORIES;
}

export function getNonRevenueCategories() {
  const groups = getIncomeGroups();
  const nonRevenueGroup = groups.find(g => g.group === "Non-revenue");
  return nonRevenueGroup?.categories || ["Pembayaran Piutang", "Other"];
}

export function getAllIncomeCategories() {
  const groups = getIncomeGroups();
  return groups.flatMap(g => g.categories);
}

export function isMetaLoaded() {
  return _metaLoaded;
}

export function resetMeta() {
  _metaLoaded = false;
  _dynamicFundSources = null;
  _dynamicIncomeGroups = null;
  _dynamicExpenseCategories = null;
}


// ---------- Transaction kind detection (uses dynamic revenue categories) ----------
export function txKind(t) {
  if (t.type === "transfer") return "transfer";
  if (t.type === "income") return getRevenueCategories().includes(t.category) ? "revenue" : "non_revenue";
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