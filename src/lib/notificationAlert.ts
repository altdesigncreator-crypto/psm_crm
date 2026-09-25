/**
 * Plays a short synthesized two-tone chime and triggers a vibration pattern
 * when a notification arrives while the app is open. public/sw.js's push
 * handler only reliably alerts (sound + vibrate) while the app is closed or
 * backgrounded to the point its tab is suspended — an open tab (even one
 * not focused) gets nothing but a silent toast today. This is the in-app
 * equivalent, wired into NotificationsContext's realtime listener so it
 * fires for every notification, not just push ones.
 *
 * No audio asset to host — the chime is synthesized via the Web Audio API.
 * Both calls are best-effort: browsers block audio/vibration before the
 * user has interacted with the page at all in that session (autoplay /
 * user-activation policy). By the time a real notification arrives that's
 * virtually always already happened (login, clicking a nav item, ...), but
 * a cold first-ever load could still get silently skipped — every call
 * here is wrapped so that never throws into the caller.
 */
interface Tone {
  freq: number;
  start: number;
  duration: number;
}

export function playNotificationAlert() {
  try {
    const AudioContextCtor: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      const ctx = new AudioContextCtor();
      const now = ctx.currentTime;
      // Two short ascending tones — a familiar "ding-ding" notification chime.
      const tones: Tone[] = [
        { freq: 880, start: now, duration: 0.12 },
        { freq: 1108, start: now + 0.14, duration: 0.16 },
      ];
      for (const { freq, start, duration } of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      }
      setTimeout(() => { ctx.close().catch(() => {}); }, 500);
    }
  } catch {
    // Autoplay/user-activation restrictions, or no Web Audio support — skip silently.
  }

  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration API unsupported or blocked — skip silently.
  }
}
