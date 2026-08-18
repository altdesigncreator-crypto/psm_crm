import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Best-effort screenshot/leak deterrents. There is no web API that can
 * actually block OS-level screen capture (Print Screen, mobile screenshot
 * gestures, another device's camera) — this only makes casual capture
 * harder:
 *  - content blurs the instant the tab/window loses focus, since that's
 *    also the moment iOS/Android snapshot the app for the switcher
 *  - right-click, printing, and devtools shortcuts are blocked to raise
 *    the bar above "casual"
 */
export default function ScreenshotGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    const onVisibility = () => setObscured(document.visibilityState !== 'visible');
    const onBlur = () => setObscured(true);
    const onFocus = () => setObscured(document.visibilityState !== 'visible');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      // Printing renders the full page into a capturable preview.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
      }
      // DevTools shortcuts — trivially reopened via the menu, but this
      // stops the one-key habit.
      if (
        e.key === 'F12'
        || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))
      ) {
        e.preventDefault();
      }
    };

    // Windows' plain PrintScreen copies the frame to the clipboard rather
    // than firing a save dialog — overwrite the clipboard right after so
    // the captured image doesn't survive the paste. Best-effort only:
    // requires clipboard-write permission and does nothing for Win+PrtScn,
    // Snipping Tool, mobile gestures, or a second camera.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        navigator.clipboard?.writeText('Screenshot restricted.').catch(() => {});
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      {children}

      {obscured && user && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-xl">
          <ShieldAlert className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">Content hidden for security</p>
        </div>
      )}
    </div>
  );
}
