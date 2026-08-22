import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import BalanceTicker from "@/components/BalanceTicker";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  LayoutDashboard, ArrowLeftRight, CalendarDays, HandCoins, BarChart3, LogOut, Menu, Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/transaksi", label: "Transaksi", icon: ArrowLeftRight, testid: "nav-transactions" },
  { to: "/event", label: "Revenue Event", icon: CalendarDays, testid: "nav-events" },
  { to: "/hutang-piutang", label: "Hutang & Piutang", icon: HandCoins, testid: "nav-debts" },
  { to: "/laporan", label: "Laporan", icon: BarChart3, testid: "nav-reports" },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="space-y-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          data-testid={item.testid}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ease-out ${
              isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const userBlock = (
    <div className="border-t border-slate-200 pt-4 mt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate" data-testid="user-name">{user?.name}</div>
          <Badge
            variant="outline"
            data-testid="user-role-badge"
            className={user?.role === "owner" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-slate-300 text-slate-600"}
          >
            {user?.role === "owner" ? "Owner" : "Team (view only)"}
          </Badge>
        </div>
        <button
          onClick={handleLogout}
          data-testid="logout-btn"
          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150"
          title="Keluar"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50" data-testid="app-layout">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-slate-200 bg-white p-4 z-30">
        <div className="flex items-center gap-3 px-2 pb-5">
          <div className="h-9 w-9 rounded-lg bg-slate-900 flex items-center justify-center">
            <Wallet className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-heading font-bold text-slate-900 leading-tight">Sariwarasa</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Finance Ledger</div>
          </div>
        </div>
        <NavItems />
        <div className="mt-auto">{userBlock}</div>
      </aside>

      {/* Header mobile */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button data-testid="mobile-menu-btn" className="p-2 rounded-lg hover:bg-slate-100 transition-colors duration-150">
              <Menu className="h-5 w-5 text-slate-700" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 flex flex-col">
            <div className="flex items-center gap-3 px-2 pb-5">
              <div className="h-9 w-9 rounded-lg bg-slate-900 flex items-center justify-center">
                <Wallet className="h-4 w-4 text-white" />
              </div>
              <div className="font-heading font-bold text-slate-900">Sariwarasa</div>
            </div>
            <NavItems onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">{userBlock}</div>
          </SheetContent>
        </Sheet>
        <div className="font-heading font-bold text-slate-900">Keuangan Sariwarasa</div>
      </header>

      {/* Main */}
      <main className="lg:pl-60">
        <div className="sticky top-0 lg:top-0 z-20 bg-slate-50/80 backdrop-blur-xl border-b border-slate-200 px-4 lg:px-8 py-3">
          <BalanceTicker />
        </div>
        <div className="p-4 lg:p-8 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
