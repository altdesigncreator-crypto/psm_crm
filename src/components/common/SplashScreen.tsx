import React, { useState, useEffect, useRef } from 'react';

const LOAD_STAGES = [
  { at: 0, label: 'Connecting…' },
  { at: 25, label: 'Restoring your session…' },
  { at: 55, label: 'Loading your workspace…' },
  { at: 90, label: 'Almost ready…' },
  { at: 100, label: 'Ready' },
];

function getIsDarkMode() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Branded loading screen, driven by the real `loading` signal from the app
 * (auth session restore + maintenance check) rather than a guessed timer:
 * while `loading` is true the bar eases toward ~90% — fast at first, never
 * fully stalling — and the instant it flips to `false` the bar races the
 * rest of the way to exactly 100%, holds briefly, then fades and calls
 * `onFinish`. A quick load never gets stuck mid-animation waiting on a fixed
 * timeout, and a slow load never stalls short of 100% — either way it always
 * completes exactly when the real work does. */
const SplashScreen: React.FC<{ loading: boolean; onFinish?: () => void }> = ({ loading, onFinish }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [entered, setEntered] = useState(false);
  const [progress, setProgress] = useState(4);
  const [isDark, setIsDark] = useState(() => getIsDarkMode());
  const finishedRef = useRef(false);

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

  // Ease toward a 96% ceiling on a real wall-clock curve (not a fixed tick
  // count) — a fast load and a slow load both approach the ceiling on the
  // same exponential curve, so a load that takes 10s still visibly climbs
  // the whole time instead of hitting a hard stop after ~3s and sitting
  // frozen for however much longer the real work takes. It never reaches
  // 100% on its own; that only happens once the real work is actually done
  // (below).
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const CEILING = 96;
    const TAU_MS = 3500;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const eased = CEILING * (1 - Math.exp(-elapsed / TAU_MS));
      setProgress((p) => Math.max(p, Math.min(CEILING, eased)));
    }, 120);
    return () => clearInterval(tick);
  }, [loading]);

  // Parent components (context providers etc.) can re-render often, which
  // would hand this component a brand-new `onFinish` function identity each
  // time. Reading it through a ref — instead of depending on it directly —
  // keeps the finishing effect below from tearing down and resetting on
  // every unrelated re-render, which used to clear its pending timer before
  // it fired and leave the screen stuck at 100%, never handing control back.
  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  // The moment real loading finishes, race to 100%. The CSS width
  // transition below animates the jump in a fixed 300ms regardless of how
  // far progress has to travel — so a fast load (still near 4%) covers more
  // distance in that same window and reads as "rapidly to 100%", while a
  // slow load (already near 90%) finishes with a short, gentle final step.
  // Either way it lands on exactly 100% right when loading actually ends.
  useEffect(() => {
    if (loading || finishedRef.current) return;
    finishedRef.current = true;
    setProgress(100);
    const fadeTimer = setTimeout(() => setFadeOut(true), 350);
    const finishTimer = setTimeout(() => onFinishRef.current?.(), 850);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [loading]);

  const stage = [...LOAD_STAGES].reverse().find((s) => progress >= s.at) || LOAD_STAGES[0];

  const bgClass = isDark ? 'bg-[#0A2540]' : 'bg-white';
  const textClass = isDark ? 'text-white' : 'text-[#0A2540]';
  const subTextClass = isDark ? 'text-white/50' : 'text-[#0A2540]/50';
  const trackClass = isDark ? 'bg-white/10' : 'bg-[#0A2540]/10';
  // Gold is the PSM accent in both themes now (matching the sidebar's gold
  // active-state accent) so the brand mark reads the same everywhere.
  const fillClass = isDark
    ? 'bg-gradient-to-r from-[#D4AF37] to-[#F0D878]'
    : 'bg-gradient-to-r from-[#C99A2E] to-[#E4C468]';

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
          <div className={`absolute inset-4 rounded-full blur-2xl opacity-30 animate-pulse ${isDark ? 'bg-[#D4AF37]/40' : 'bg-[#D4AF37]/25'}`} />
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
