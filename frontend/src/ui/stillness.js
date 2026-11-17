import { useEffect } from "react";

/** After this long with no input, the scenery stops moving until the next input. */
export const IDLE_MS = 60_000;

/**
 * Pause the scenery's CSS animations while nobody is looking: the tab is hidden, or nothing
 * was clicked, typed, scrolled or pointed at for IDLE_MS. Sets <html data-still>, which
 * theme.css uses to pause every pm-* animation. Mount once (AppShell does). R1.21: Nether
 * Gate and Ancient City cost 15-18 % of a CPU core while idle, from their animated overlays.
 */
export function useStillness() {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    const set = (still) => {
      if (still) root.dataset.still = "";
      else delete root.dataset.still;
    };
    const wake = () => {
      clearTimeout(timer);
      if (document.hidden) return set(true);
      set(false);
      timer = setTimeout(() => set(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "focusin"];
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, wake));
      document.removeEventListener("visibilitychange", wake);
      set(false);
    };
  }, []);
}
