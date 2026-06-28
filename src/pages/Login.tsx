import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getCachedCredentials, isOnline } from '@/lib/offlineAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Eye, EyeOff, WifiOff, Fingerprint } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [networkStatus, setNetworkStatus] = useState(isOnline());

  useEffect(() => {
    const cached = getCachedCredentials();
    if (cached?.email) setEmail(cached.email);
  }, []);

  useEffect(() => {
    const handleOnline = () => setNetworkStatus(true);
    const handleOffline = () => setNetworkStatus(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formattedEmail = email.toLowerCase().trim();

    try {
      // Fire authentication request directly down to our updated Firestore collection logic
      const staffUser = await login(formattedEmail, password);

      const staffSession = {
        uid: staffUser.uid,
        name: staffUser.name,
        email: staffUser.email,
        role: staffUser.role,
        department: staffUser.department,
        permissions: staffUser.permissions || []
      };

      // Save valid workspace session
      localStorage.setItem('psm_staff_session', JSON.stringify(staffSession));
      toast.success(`မင်္ဂလာပါ ${staffSession.name}`);
      navigate('/dashboard');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'စနစ်အတွင်း ဝင်ရောက်ရန် အဆင်မပြေပါ။');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-md animate-fade-in-up space-y-3">
        {!networkStatus && (
          <div className="flex items-center gap-2 rounded-lg bg-warning/10 border border-warning/20 px-4 py-2.5 text-sm text-warning">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="font-medium">အင်တာနက် ချိတ်ဆက်မှု မရှိပါ</span>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-card p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-4 shadow-card">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Welcome Back</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your PSM Sale CRM account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">အီးမေးလ်</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">စကားဝှက်</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 gradient-primary hover:gradient-primary-hover text-white font-medium transition-all duration-300 hover:shadow-card-hover active:scale-[0.98]"
            >
              {loading ? 'ဝင်ရောက်နေသည်...' : 'အကောင့်ဝင်ရန်'}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Fingerprint className="w-3.5 h-3.5" />
            <span>Staff Profile Credentials Protection Matrix</span>
          </div>
        </div>
      </div>
    </div>
  );
}