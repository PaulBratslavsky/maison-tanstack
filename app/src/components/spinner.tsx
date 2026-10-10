/**
 * LINE's loading icon, as LINE asks LINE MINI Apps to show one: its own 30×30 spinner, centered
 * (https://developers.line.biz/en/docs/line-mini-app/design/loading-icon/). The label says what's loading, under the
 * spinner and to screen readers.
 */
export function Spinner({ label, className = 'py-10' }: { label: string; className?: string }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-2 px-5 ${className}`}>
      <img src="/line/LINE_spinner_light.svg" width={30} height={30} alt="" />
      <p className="text-xs text-mist">{label}</p>
    </div>
  );
}
