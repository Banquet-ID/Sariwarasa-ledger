import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { toast } from "sonner";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    const sessionId = window.location.hash.split("session_id=")[1]?.split("&")[0];
    (async () => {
      try {
        const r = await api.post("/auth/google-session", { session_id: sessionId });
        setUser(r.data);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/", { replace: true, state: { user: r.data } });
      } catch (e) {
        toast.error("Login Google gagal, silakan coba lagi");
        navigate("/login", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="auth-callback-loading">
      <div className="text-sm text-slate-500 font-medium animate-pulse">Memproses login...</div>
    </div>
  );
}
