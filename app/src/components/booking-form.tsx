import { useForm, useStore } from '@tanstack/react-form';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import { bookingDays, bookingState, hasStock, isBookableDate, requestVisit, type VisitChoice } from '../lib/booking';
import { COPY } from '../lib/copy';
import { dayLabel } from '../lib/format';
import { errorText, type ScreenError } from '../lib/status';
import type { Appointment, BoutiqueInfo } from '../lib/types';
import { useToday } from '../lib/use-today';
import { useTool } from '../lib/use-tool';
import { ErrorNote } from './error-note';
import { useMaison } from './maison-provider';
import { Spinner } from './spinner';

/** Arrow keys move along a row of radios, Home and End go to its ends: each picks the chip it lands on. */
const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A row of chips to pick one from, as the mockup draws the day and the time: a radio group named by its label, whose
 * chips are radios (one tab stop, arrow keys between them). It scrolls sideways when the chips don't fit, and brings the
 * chosen one into view when the row appears or its chips change.
 */
function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  const row = useRef<HTMLDivElement>(null);
  const checked = options.findIndex((option) => option.value === value);
  const focusable = Math.max(checked, 0);
  const chips = options.map((option) => option.value).join();

  useEffect(() => {
    const list = row.current;
    const chip = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (list && chip) list.scrollLeft = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
  }, [chips]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key];
    const target =
      event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : step ? (focusable + step + options.length) % options.length : -1;
    if (target < 0 || options.length === 0) return;
    event.preventDefault();
    onChange(options[target].value);
    (row.current?.children[target] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="label">
        {label}
      </p>
      <div
        ref={row}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={move}
        // Bleeds to the form's edges, with 4 px above and below for a chip's focus ring, which a scroller would clip.
        className="relative -mx-5 -my-1 flex gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={index === checked}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onChange(option.value)}
            className="chip w-[72px] flex-none"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The booking form, shared by the product page's Book a visit sheet (components/booking-sheet.tsx) and the concierge's
 * visit picker (components/visit-picker.tsx). The boutique is a radio per boutique, disabled where none of the pieces is
 * in stock; the day and the time are rows of chips: the next two weeks, and the half-hour slots the chosen boutique is
 * open on that day. TanStack Form holds the four values (boutique, day, time, note) and the submit. Send request calls request_appointment with the customer's own session (requestVisit in
 * lib/booking.ts), and a refusal shows here, as it always has on the sheet. `header` comes first, inside the form: the
 * sheet's handle and heading, or the picker's. `dismiss` is a second button under Send request: the picker's Not now.
 */
export function BookingForm({
  screen,
  products,
  initial,
  disabled = false,
  onBooked,
  onSendingChange,
  dismiss,
  header,
  className,
}: {
  /** The screen whose agent view lists the form's calls: "product" for the sheet, "concierge" for the picker. */
  screen: string;
  /** The pieces to see: the sheet's one, or the picker's one to five. */
  products: string[];
  /** The boutique, day and time the form starts with. */
  initial: VisitChoice;
  /** While true, neither button does anything: a picker that isn't the live one, or that waits for a reply. */
  disabled?: boolean;
  /** The visit Strapi stored. Send request stays busy after it: the caller moves on. */
  onBooked: (appointment: Appointment) => void;
  /** Told when a request starts (true), and when it ends in a problem (false). */
  onSendingChange?: (sending: boolean) => void;
  dismiss?: { label: string; onDismiss: () => void };
  header: ReactNode;
  className: string;
}) {
  const { maison, locale } = useMaison();
  const t = COPY[locale];
  const now = useToday();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<ScreenError | null>(null);
  const boutiqueLabel = useId();

  // TanStack Form holds what the customer chose: the boutique, the day, the time and the note.
  const form = useForm({
    defaultValues: { boutique: initial.boutique, date: initial.date, time: initial.time, note: '' },
    onSubmit: async ({ value }) => {
      if (sending || disabled) return;
      if (!maison || !chosen || !startTime) return;
      setSending(true);
      setProblem(null);
      onSendingChange?.(true);
      // The answer names the boutique and products in the customer's language.
      const outcome = await requestVisit((name, args) => maison.callTool(screen, name, args), {
        boutique: chosen.slug,
        products,
        date: value.date,
        startTime,
        note: value.note,
        locale,
      });
      if (outcome.ok) {
        // `sending` stays on: the button stays disabled while the caller moves on.
        onBooked(outcome.appointment);
        return;
      }
      // A refusal, or a failure on the way, stays in the form: nothing else hears of it.
      setSending(false);
      setProblem(outcome.problem);
      onSendingChange?.(false);
    },
  });
  const { boutique, date, time } = useStore(form.store, (state) => state.values);

  // Only a bookable date is checked, and sent: the tools take only real calendar dates.
  const availability = useTool<{ boutiques: BoutiqueInfo[] }>(
    screen,
    'find_boutiques',
    isBookableDate(date, now) ? { productSlugs: products, date, locale } : null
  );
  const boutiques = availability.data?.boutiques ?? [];
  const { validDate, dateProblem, chosen, open, slots, startTime } = bookingState({
    date,
    boutique,
    time,
    products,
    boutiques,
    loading: availability.loading,
    now,
  });

  /** A new boutique, date or time makes the last send's problem stale. */
  const staleProblem = { onChange: () => setProblem(null) };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <form onSubmit={submit} className={className}>
      {header}

      {/* A real radio per boutique, named by its label. One without any of the pieces is disabled and says so. */}
      <fieldset role="radiogroup" aria-labelledby={boutiqueLabel} className="m-0 min-w-0 border-0 p-0">
        <legend id={boutiqueLabel} className="label pb-2">
          {t.boutique}
        </legend>
        {boutiques.length === 0 && availability.loading ? (
          // Three rows' room while the first answer comes, so the form doesn't grow under the finger.
          <div className="h-[132px]" />
        ) : (
          <form.Field name="boutique" listeners={staleProblem}>
            {(field) =>
              boutiques.map((option) => {
                const stocked = hasStock(option, products);
                return (
                  <label
                    key={option.slug}
                    className={`flex min-h-[44px] items-center justify-between gap-4 border-t border-hairline text-[14px] last:border-b ${stocked ? 'cursor-pointer' : 'cursor-not-allowed text-mist'}`}
                  >
                    <span>
                      {option.name}
                      {stocked ? '' : ` · ${t.notInStock}`}
                    </span>
                    <input
                      type="radio"
                      name={field.name}
                      value={option.slug}
                      checked={chosen?.slug === option.slug}
                      disabled={!stocked}
                      onChange={() => field.handleChange(option.slug)}
                      className="m-0 h-[18px] w-[18px] shrink-0"
                    />
                  </label>
                );
              })
            }
          </form.Field>
        )}
      </fieldset>

      <form.Field name="date" listeners={staleProblem}>
        {(field) => (
          <ChipRow
            label={t.date}
            options={bookingDays(now).map((day) => ({ value: day.date, label: dayLabel(day.date, locale) }))}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>

      {/* The time, or why there's none yet. The room for a row of chips is kept, so nothing jumps while a day is checked. */}
      <div className="flex min-h-[68px] flex-col justify-center gap-3">
        {validDate && availability.loading ? (
          <Spinner label={t.loading} className="py-0" />
        ) : validDate && availability.error ? (
          <ErrorNote
            error={availability.error}
            action={
              <button type="button" onClick={availability.retry} className="btn-text">
                {t.retry}
              </button>
            }
          >
            {errorText(availability.error, locale)}
          </ErrorNote>
        ) : validDate && chosen && !open ? (
          <ErrorNote role="status">{t.closedOnDate}</ErrorNote>
        ) : open ? (
          <form.Field name="time" listeners={staleProblem}>
            {(field) => (
              <ChipRow label={t.time} options={slots.map((slot) => ({ value: slot, label: slot }))} value={startTime} onChange={field.handleChange} />
            )}
          </form.Field>
        ) : null}
        {dateProblem && <ErrorNote role="status">{t[dateProblem]}</ErrorNote>}
      </div>

      <form.Field name="note">
        {(field) => (
          <label className="flex flex-col gap-1.5">
            <span className="label">{t.note}</span>
            <textarea
              name={field.name}
              maxLength={500}
              rows={1}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={t.notePlaceholder}
              className="field max-h-32 resize-none [field-sizing:content]"
            />
          </label>
        )}
      </form.Field>

      {problem && (
        // `chosen` is the boutique the request was for: picking another clears the problem.
        <ErrorNote error={problem}>{errorText(problem, locale, chosen?.name)}</ErrorNote>
      )}
      <div className="flex flex-col gap-2.5">
        {/* While it sends, the button stays black with LINE's light spinner: it's busy, not unavailable. */}
        <button
          type="submit"
          disabled={sending || !startTime || disabled}
          className={`btn-primary w-full ${sending ? 'disabled:cursor-wait disabled:bg-ink disabled:text-paper' : ''}`}
        >
          {sending && <img src="/line/LINE_spinner_light.svg" width={16} height={16} alt="" />}
          {sending ? t.loading : t.request}
        </button>
        {dismiss && (
          <button type="button" onClick={dismiss.onDismiss} disabled={sending || disabled} className="btn-secondary w-full">
            {dismiss.label}
          </button>
        )}
        <p className="text-center text-[12px] text-graphite">{t.confirmsOnLine}</p>
      </div>
    </form>
  );
}
