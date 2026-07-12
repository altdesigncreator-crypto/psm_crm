import React, { useState, useEffect } from 'react';

const LOAD_STAGES = [
  { at: 0, label: 'Connecting…' },
  { at: 25, label: 'Restoring your session…' },
  { at: 55, label: 'Loading your workspace…' },
  { at: 82, label: 'Almost ready…' },
];

function getIsDarkMode() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Branded loading screen. Progress eases toward ~92% like a real task and
 * completes only when the app is ready: with `onFinish` it self-dismisses
 * after its animation; without it, the parent unmounts it once the auth
 * session has settled (see App.tsx). */
const SplashScreen: React.FC<{ onFinish?: () => void }> = ({ onFinish }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [entered, setEntered] = useState(false);
  const [progress, setProgress] = useState(4);
  const [isDark, setIsDark] = useState(() => getIsDarkMode());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Entrance: fade + lift the whole block in on mount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Ease toward 92% with decaying increments — fast at first, slowing as it
  // climbs, the way real loading feels. The final jump to 100% only happens
  // when the app is actually ready (fade-out / unmount).
  useEffect(() => {
    const tick = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        const step = (92 - p) * 0.06 + Math.random() * 1.4;
        return Math.min(92, p + step);
      });
    }, 160);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!onFinish) return;
    const fadeTimer = setTimeout(() => { setProgress(100); setFadeOut(true); }, 2600);
    const finishTimer = setTimeout(() => onFinish(), 3200);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  const stage = [...LOAD_STAGES].reverse().find((s) => progress >= s.at) || LOAD_STAGES[0];

  const bgClass = isDark ? 'bg-[#0A2540]' : 'bg-[#F8FAFC]';
  const textClass = isDark ? 'text-white' : 'text-[#0A2540]';
  const subTextClass = isDark ? 'text-white/50' : 'text-[#0A2540]/50';
  const trackClass = isDark ? 'bg-white/10' : 'bg-[#0A2540]/10';
  const fillClass = isDark
    ? 'bg-gradient-to-r from-[#D4AF37] to-[#F0D878]'
    : 'bg-gradient-to-r from-[#0463CA] to-[#0487E2]';

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center ${bgClass} transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div
        className={`flex flex-col items-center relative z-10 transition-all duration-700 ease-out ${
          entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        {/* Brand wordmark with a soft breathing glow */}
        <div className="relative">
          <div className={`absolute inset-4 rounded-full blur-2xl opacity-30 animate-pulse ${isDark ? 'bg-[#5AA4E4]/50' : 'bg-[#0463CA]/30'}`} />
          <img
            src={isDark ? '/logo-dark.png' : '/logo.png'}
            alt="PSM Properties"
            className="relative w-52 h-auto"
            draggable={false}
          />
        </div>

        {/* Progress */}
        <div className="w-64 mt-10">
          <div className={`h-1 rounded-full overflow-hidden ${trackClass}`}>
            <div
              className={`h-full rounded-full ${fillClass} transition-[width] duration-300 ease-out`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className={`text-xs font-medium ${subTextClass}`}>{stage.label}</span>
            <span className={`text-xs font-semibold tabular-nums ${textClass}`}>{Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <span className={`text-[10px] font-medium tracking-wider ${isDark ? 'text-white/30' : 'text-[#0A2540]/30'}`}>v104</span>
      </div>
    </div>
  );
};

export default SplashScreen;
