import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import Events from "@/pages/Events";
import Debts from "@/pages/Debts";
import Reports from "@/pages/Reports";

import Settings from "@/pages/Settings";

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (location.state?.user) return <Layout />;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="auth-loading">
        <div className="text-sm text-slate-500 font-medium animate-pulse">Memuat...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function AppRouter() {
  const location = useLocation();
  // Check URL fragment (not query params) for session_id — must run before Protected routes
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transaksi" element={<Transactions />} />
        <Route path="/event" element={<Events />} />
        <Route path="/hutang-piutang" element={<Debts />} />
        <Route path="/laporan" element={<Reports />} />
        <Route path="/pengaturan" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
