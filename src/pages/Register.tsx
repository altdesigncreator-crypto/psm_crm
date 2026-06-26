import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('အီးမေးလ်၊ စကားဝှက် နှင့် အတည်ပြုစကားဝှက် အားလုံး ဖြည့်ရန်လိုအပ်ပါသည်။');
      return;
    }

    if (password !== confirmPassword) {
      setError('စကားဝှက်နှင့် အတည်ပြုစကားဝှက် ကိုက်ညီမှု မရှိပါ။');
      return;
    }

    if (password.length < 6) {
      setError('စကားဝှက် အနည်းဆုံး ၆ လုံးဖြစ်ရန်လိုအပ်ပါသည်။');
      return;
    }

    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      toast.success('အကောင့်ဖွင့်ခြင်း အောင်မြင်ပါသည်');
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('email-already-in-use')) {
        setError('ဤအီးမေးလ်ဖြင့် အကောင့်ရှိပြီးသားဖြစ်ပါသည်။');
      } else if (msg.includes('invalid-email')) {
        setError('အီးမေးလ် ပုံစံ မမှန်ကန်ပါ။');
      } else if (msg.includes('weak-password')) {
        setError('စကားဝှက် အားနည်းနေပါသည်။ အနည်းဆုံး ၆ လုံး ထည့်သွင်းပါ။');
      } else {
        setError('အကောင့်ဖွင့်ရာတွင် အမှားဖြစ်သွားပါသည်။ ပြန်လည်ကြိုးစားပါ။');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
      <div className="w-full max-w-md animate-fade-in-up space-y-3">
        <div className="bg-white rounded-lg shadow-card p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-4 shadow-card">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Create Account</h1>
            <p className="text-sm text-muted-foreground mt-1">PSM Sale CRM အကောင့်အသစ်ဖွင့်ရန်</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="reg-email" className="text-sm font-medium">အီးမေးလ်</Label>
              <Input
                id="reg-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-password" className="text-sm font-medium">စကားဝှက်</Label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="အနည်းဆုံး ၆ လုံး"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted/80 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reg-confirm" className="text-sm font-medium">အတည်ပြုစကားဝှက်</Label>
              <div className="relative">
                <Input
                  id="reg-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="စကားဝှက်ထပ်မံ ထည့်သွင်းပါ"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted/80 transition-colors"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
              {loading ? 'ဖွင့်နေသည်...' : 'အကောင့်ဖွင့်ရန်'}
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-sm text-primary hover:underline"
              >
                ရှိပြီးသား အကောင့်ဖြင့် ဝင်ရောက်ရန်
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
