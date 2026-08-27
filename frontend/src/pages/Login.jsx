import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export default function Login() {
  const { user, loading, login, setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || document.getElementById("gsi-script")) return;
    const script = document.createElement("script");
    script.id = "gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          try {
            const r = await api.post("/auth/google", { credential: resp.credential });
            localStorage.setItem("sw_token", r.data.token);
            setUser(r.data.user);
            navigate("/", { replace: true });
          } catch (err) {
            toast.error(err.response?.data?.detail || "Login Google gagal");
          }
        },
      });
      window.google?.accounts.id.renderButton(
        document.getElementById("google-signin-button"),
        { theme: "outline", size: "large", width: 320, text: "signin_with", locale: "id" }
      );
    };
    document.body.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login gagal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50" data-testid="login-page">
      <div
        className="hidden lg:block bg-cover bg-center"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHwxfHxtaW5pbWFsaXN0JTIwYWJzdHJhY3QlMjBsaWdodCUyMGJhY2tncm91bmR8ZW58MHx8fHwxNzg3Mzg2MjE2fDA&ixlib=rb-4.1.0&q=85)",
        }}
      >
        <div className="h-full w-full bg-slate-900/70 flex flex-col justify-end p-12">
          <h1 className="font-heading text-4xl font-bold text-white tracking-tight">Keuangan Sariwarasa</h1>
          <p className="text-slate-300 mt-3 max-w-md text-sm leading-relaxed">
            Pencatatan pemasukan, pengeluaran, hutang-piutang, dan saldo sumber dana — cepat untuk operasional harian.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-lg bg-slate-900 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-heading font-bold text-lg text-slate-900 leading-tight">Sariwarasa</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">Finance Ledger</div>
            </div>
          </div>

          <h2 className="font-heading text-2xl font-semibold text-slate-900 tracking-tight">Masuk</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">Gunakan akun owner atau team Anda.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@sariwarasa.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              data-testid="login-submit-btn"
              disabled={submitting}
              className="w-full rounded-lg active:scale-95 transition-transform duration-150"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Masuk
            </Button>
          </form>

          {GOOGLE_CLIENT_ID ? (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">atau</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="flex justify-center" data-testid="login-google-btn">
                <div id="google-signin-button" />
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 mt-5 text-center">
              Login Google nonaktif — REACT_APP_GOOGLE_CLIENT_ID belum diset.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
