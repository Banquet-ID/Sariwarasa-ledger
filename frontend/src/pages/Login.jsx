import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
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

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">atau</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <Button
            variant="outline"
            data-testid="login-google-btn"
            onClick={handleGoogle}
            className="w-full rounded-lg active:scale-95 transition-transform duration-150"
          >
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.02c2.2-2 3.46-5 3.46-8.78z"/>
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.06 7.9-2.9l-3.76-2.9c-1 .7-2.36 1.2-4.1 1.2-3.14 0-5.8-2.1-6.76-5l-.14.01-3.68 2.85-.05.13C3.36 21.3 7.34 24 12 24z"/>
              <path fill="#FBBC05" d="M5.24 14.4c-.24-.72-.38-1.5-.38-2.4s.14-1.68.36-2.4l-.01-.16-3.72-2.9-.12.05C.5 8.3 0 10.06 0 12s.5 3.7 1.37 5.4l3.87-3z"/>
              <path fill="#EA4335" d="M12 4.6c2.24 0 3.75.97 4.6 1.78l3.37-3.3C17.87 1.1 15.2 0 12 0 7.34 0 3.36 2.7 1.37 6.6l3.86 3c.96-2.9 3.62-5 6.77-5z"/>
            </svg>
            Masuk dengan Google
          </Button>
        </div>
      </div>
    </div>
  );
}
