import type { ReactNode } from 'react';

/**
 * A hairline details list, as the product mockup draws one: rows at 13 px, each a name in graphite on the left and its
 * value on the right, over a hairline, with one under the last. A product's size and stock; a visit's pieces and note.
 */
export function Details({ className = '', children }: { className?: string; children: ReactNode }) {
  return <dl className={`border-b border-hairline text-[13px] ${className}`}>{children}</dl>;
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 border-t border-hairline py-[11px]">
      <dt className="shrink-0 text-graphite">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}
