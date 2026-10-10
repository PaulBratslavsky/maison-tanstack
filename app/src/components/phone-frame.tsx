import type { ReactNode } from 'react';

/**
 * On a phone the app fills the screen, inside LINE's safe area (styles.css). On the stage laptop (`stage:`, a
 * wide screen with a mouse or trackpad) it sits in a phone-sized frame on the page's neutral wash: a thin, square black
 * bezel (an outline, so the screen stays 375 px wide), 812 px high, or the window's height less the frame's 2rem above
 * and below, so it fits a 720p projector without a scrollbar. A phone turned to landscape stays full screen.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh stage:flex stage:items-center stage:justify-center stage:py-8">
      <div className="relative min-h-dvh bg-paper stage:h-[min(812px,calc(100dvh_-_4rem))] stage:min-h-0 stage:w-[375px] stage:overflow-hidden stage:outline stage:outline-[6px] stage:outline-ink">
        <div data-testid="app-area" className="h-full px-[var(--line-safe-x)] pb-[var(--line-safe-bottom)] stage:overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
