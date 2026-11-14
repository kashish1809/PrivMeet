import { useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";

import { IconButton, PixelScape, PixelStars } from "../ui";
import Sidebar, { Logo } from "./Sidebar";

const BORDER = "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
// The phone bar sits over the scenery: slightly see-through, text still on a near-solid surface.
// The sidebar stays solid and the scenery starts at its edge. No backdrop blur: it would repaint
// on every scroll on low-end machines.
const GLASS = "border-zinc-200/80 bg-white/85 dark:border-zinc-800/80 dark:bg-zinc-900/85";

/**
 * Page frame: sidebar + content. Pages render only their content.
 * >= 900 px: full sidebar. 640-899 px: icon rail. < 640 px: top bar with a drawer.
 */
export default function AppShell({ page, system, error, children }) {
  const drawer = useRef(null);
  const close = () => drawer.current?.close();

  // Any navigation (link click, back button) closes the phone drawer.
  useEffect(close, [page]);

  return (
    // color-scheme follows the app theme, not the OS, so native scrollbars match in a forced dark/light theme.
    <div className="relative isolate flex min-h-dvh bg-zinc-50 scheme-light dark:bg-zinc-950 dark:scheme-dark">
      {/* The scenery stays put behind the page area while pages scroll over it: stars filling the
          window on dark themes, the landscape along the bottom of the window. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-y-0 right-0 left-0 -z-10 sm:left-17 min-[900px]:left-60">
        <PixelStars className="absolute inset-0" />
        <PixelScape className="absolute inset-x-0 bottom-0 h-[42vh] min-h-56 [mask-image:linear-gradient(to_bottom,transparent_0%,black_35%)]" />
      </div>

      <aside className={`sticky top-0 hidden h-dvh w-17 shrink-0 border-r sm:block min-[900px]:w-60 ${BORDER}`}>
        <Sidebar page={page} system={system} error={error} rail />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-3 sm:hidden ${GLASS}`}>
          <IconButton icon={Menu} label="Open menu" onClick={() => drawer.current?.showModal()} />
          <Logo />
        </header>
        {/* Bottom padding lets the last row scroll clear of the landscape. */}
        <main className="flex-1 px-4 pt-6 pb-[30vh] sm:px-6 lg:px-8">{children}</main>
      </div>

      {/* Native modal <dialog>: focus trap, Esc to close and an inert page behind it for free. */}
      <dialog
        ref={drawer}
        aria-label="Menu"
        onClick={(e) => e.target === e.currentTarget && close()}
        className={`m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r backdrop:bg-black/40 ${BORDER}`}
      >
        <div className="relative h-full">
          <IconButton icon={X} label="Close menu" onClick={close} className="absolute top-5 right-3" />
          <Sidebar page={page} system={system} error={error} />
        </div>
      </dialog>
    </div>
  );
}
