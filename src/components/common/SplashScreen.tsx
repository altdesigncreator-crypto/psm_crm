import React, { useState, useEffect } from 'react';

function playStartupSound() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Elegant chime: two ascending notes
    const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.5);
    });
  } catch {
    // Audio not supported or blocked
  }
}

const SPLASH_TEXT = 'PSM Sale CRM';

function getIsDarkMode() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const SplashScreen: React.FC<{ onFinish: () => void }> = ({ onFinish }) => {
  const [fadeOut, setFadeOut] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [isDark, setIsDark] = useState(() => getIsDarkMode());

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Typing animation
  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      if (idx <= SPLASH_TEXT.length) {
        setTypedText(SPLASH_TEXT.slice(0, idx));
        idx++;
      } else {
        clearInterval(interval);
        setShowCursor(false);
        // Stagger reveal other elements after typing finishes
        setTimeout(() => setSubtitleVisible(true), 200);
        setTimeout(() => setProgressVisible(true), 500);
      }
    }, 110);
    return () => clearInterval(interval);
  }, []);

  // Blinking cursor
  useEffect(() => {
    if (!showCursor) return;
    const blink = setInterval(() => {
      setShowCursor((v) => !v);
    }, 530);
    return () => clearInterval(blink);
  }, [showCursor]);

  useEffect(() => {
    playStartupSound();
    const fadeTimer = setTimeout(() => setFadeOut(true), 2800);
    const finishTimer = setTimeout(() => onFinish(), 3400);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  const bgClass = isDark ? 'bg-[#0A2540]' : 'bg-[#F8FAFC]';
  const textClass = isDark ? 'text-white' : 'text-[#0A2540]';
  const accentTextClass = isDark ? 'text-[#D4AF37]' : 'text-[#0463CA]';
  const cursorBg = isDark ? 'bg-[#D4AF37]' : 'bg-[#0463CA]';
  const progressTrack = isDark ? 'bg-white/10' : 'bg-[#0A2540]/10';
  const patternOpacity = isDark ? 'opacity-[0.03]' : 'opacity-[0.06]';

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center ${bgClass} transition-opacity duration-700 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle pattern overlay */}
      <div className={`absolute inset-0 ${patternOpacity}`} style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, ${isDark ? 'white' : '#0A2540'} 1px, transparent 0)`,
        backgroundSize: '32px 32px',
      }} />

      <div className="flex flex-col items-center gap-7 relative z-10 min-h-[200px]">
        {/* Main title with typing effect */}
        <div className="flex flex-col items-center gap-4">
          <h1 className={`text-4xl md:text-5xl font-extrabold ${textClass} tracking-tight text-balance min-h-[3.5rem] md:min-h-[4.5rem]`}>
            {typedText}
            <span
              className={`inline-block w-[3px] h-[0.9em] ${cursorBg} ml-1 align-middle rounded-sm transition-opacity duration-100 ${
                showCursor ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </h1>

          {/* Subtitle — fade-in stagger */}
          <div
            className={`flex items-center gap-3 transition-all duration-700 ${
              subtitleVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
            }`}
          >
            <div className={`w-10 h-[2px] ${isDark ? 'bg-[#D4AF37]' : 'bg-[#0463CA]'} rounded-full`} />
            <p className={`text-sm md:text-base ${accentTextClass} tracking-[0.2em] uppercase font-medium`}>
              Properties
            </p>
            <div className={`w-10 h-[2px] ${isDark ? 'bg-[#D4AF37]' : 'bg-[#0463CA]'} rounded-full`} />
          </div>
        </div>

        {/* Progress bar — fade-in stagger */}
        <div
          className={`w-32 h-1 ${progressTrack} rounded-full overflow-hidden transition-all duration-700 ${
            progressVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          <div className={`h-full ${isDark ? 'bg-gradient-to-r from-[#D4AF37] to-[#F0D878]' : 'bg-gradient-to-r from-[#0463CA] to-[#0487E2]'} rounded-full animate-[slide_1.8s_ease-in-out_infinite]`} />
        </div>
      </div>

      {/* Version badge */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-[#0A2540]/30'} font-medium tracking-wider`}>v104</span>
      </div>
    </div>
  );
};

export default SplashScreen;
