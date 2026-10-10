import { describe, expect, it } from 'vitest';

import { COPY } from '../copy';
import { asksToVisit } from './asks-to-visit';

describe('asksToVisit', () => {
  // Paul's five messages in production on 3 October, in order: only the third and the fifth ask for a visit.
  const production: Array<[string, boolean]> = [
    ['When is a good time to come into to the store', false],
    ['Yes', false],
    ['Can I book a visit?', true],
    ['What do you have', false],
    ['I would like to book a visit to see cabin case', true],
  ];

  it("reads Paul's production messages as he meant them", () => {
    for (const [text, asks] of production) expect.soft(asksToVisit(text), text).toBe(asks);
  });

  it("hears the demo's suggestions that ask for a visit, in both languages", () => {
    for (const locale of ['en', 'ja'] as const) {
      for (const text of COPY[locale].suggestions) expect.soft(asksToVisit(text), text).toBe(true);
    }
    expect(COPY.en.suggestions[0]).toContain('Could I see it in Ginza on Saturday at 2 pm?');
    expect(COPY.ja.suggestions[0]).toContain('土曜日の14時に銀座で見られますか？');
  });

  it('hears an English request: can, could or may I or we; I would, we would like to; I or we want to; let’s book; book it', () => {
    const asks = [
      // can / could / may + I / we, with each verb
      'Can I book a visit?',
      'Could we visit the Ginza boutique?',
      'May I schedule a visit for Saturday?',
      'Can we schedule one?',
      'Can we reserve a time on Friday?',
      'Can I make an appointment?',
      'Could we make a booking for Saturday?',
      'May I make a reservation?',
      'Can I come in on Saturday?',
      'Could we come by tomorrow afternoon?',
      'Can I come over to see it?',
      'Can I drop in this weekend?',
      'Could I drop by on Sunday?',
      'Can we stop by later today?',
      'Could I please book a visit?',
      // seeing a piece in person, in store, at a boutique, or in a boutique's city
      'Can I see it in person?',
      'Could I see them in store?',
      'Can we see this at the boutique?',
      'May I see these at the Omotesando boutique?',
      'Can I see the Weekender 50 in person?',
      'Could I see the Cabin Case 55 in Osaka?',
      'Can I see it in Shinsaibashi?',
      'Can I see it in Ginza?',
      'Could I see them at the Omotesando boutique on Friday?',
      // I'd / I would / we'd / we would like to (and love to)
      "I'd like to book a visit.",
      'I’d like to book a visit.',
      'I would like to book a visit to see cabin case',
      "We'd like to come in on Saturday.",
      'We would like to see it in person.',
      "I'd love to see these in person.",
      // I / we want to
      'I want to visit the Ginza boutique.',
      'I want to see them in person',
      'We want to schedule a visit.',
      // let's book / schedule
      "Let's book it.",
      'Let’s schedule one for Saturday.',
      // book it / one / a visit / an appointment
      'Book it, please.',
      'BOOK one for Saturday, please.',
      'Please book one for Saturday.',
      'Book a visit for me.',
      'Book an appointment for Saturday at 2 pm.',
    ];
    for (const text of asks) expect.soft(asksToVisit(text), text).toBe(true);
  });

  it('hears no English request in a question, however it names a visit', () => {
    const plain = [
      'What time do you open?',
      'When is a good time to come in?',
      'What do you have?',
      'How do I care for the leather?',
      'Can it hold a watch?',
      'Is it in stock in Ginza?',
      'Can I see it?',
      'Let me see, what do you have in Ginza?',
      'A notebook for my father?',
      'Do your visitors get gift wrapping?',
      'Booking for two, please.',
      "I'd like a reservation for Saturday.",
      'Do I need a reservation?',
      '',
    ];
    for (const text of plain) expect.soft(asksToVisit(text), text).toBe(false);
  });

  it('lets an English exclusion win over a request: a visit already asked for, changing or checking one, its cost, whether one is needed, a no, visiting hours, or another kind of booking', () => {
    const excluded = [
      // the review's examples: questions about a visit already requested
      'When will the boutique confirm my visit?',
      'Did my booking go through?',
      'Can you show my appointments?',
      'Can I cancel my appointment?',
      'Is my booking confirmed?',
      'Do I have any appointments?',
      // my / our + visit, booking, appointment, reservation, request
      'Can I book my visit for 3 pm instead?',
      'Could we stop by for our booking?',
      'Can I come in before my appointment?',
      'I would like to visit for my reservation.',
      'Can I book a visit? See my request.',
      'Can we come by before our next visit?',
      // cancel, change, reschedule, move, confirm, check, status
      'Can I book a visit and cancel the other one?',
      'Can I book a visit or change the day?',
      'Can I reschedule and book a visit for Sunday?',
      'Can we visit on Sunday instead, or move it?',
      'Could I visit once the boutique can confirm it?',
      'Can I book a visit and get it confirmed today?',
      'Can I come in to check the colors?',
      'Can I book a visit? What is the status?',
      // policy, cost, free, fee, charge
      'Can I book a visit? What is your policy?',
      'Can I book a visit, and does it cost anything?',
      'Can I book a visit for free?',
      'Can I book a visit without a fee?',
      'Do you charge if I want to book a visit?',
      // need to, have to, required
      'Do I need to book a visit?',
      'Do I have to book a visit first?',
      'Is a visit required, or can I just come in?',
      // don't, can't, no thanks, not now
      "I don't want to book a visit yet.",
      'Sorry, I can’t book a visit after all.',
      'No thanks, I would like to book a visit later.',
      'Not now, but I want to visit later.',
      // visiting hours
      'Can I visit during visiting hours?',
      // a table, restaurant, hotel, taxi or flight
      'Can I book a table?',
      'Could I book a restaurant near Ginza?',
      'Can I book a hotel in Ginza?',
      'Can I book a taxi to the boutique?',
      'I would like to book a flight to Osaka.',
    ];
    for (const text of excluded) expect.soft(asksToVisit(text), text).toBe(false);
  });

  it('hears a Japanese request: 予約したい, 予約できますか, 来店したい, 見に行きたい, and 伺いたい or 見られますか with a place, a day or 実物', () => {
    const asks = [
      '予約したいです。',
      '来店の予約をしたいです。',
      '土曜日に予約できますか？',
      '来店を予約できますか？',
      '予約をお願いします。',
      '予約させてください。',
      '来店したいです。',
      '明日来店できますか？',
      '実物を見に行きたいです。',
      '見に行ってもいいですか？',
      // 伺いたい, お伺いしても, お伺いしたい: next to a place or a day
      '土曜日に銀座のお店に伺いたいです。',
      '表参道の店舗に伺いたいのですが。',
      '明日お伺いしてもよろしいですか？',
      '来週、心斎橋のブティックにお伺いしたいです。',
      '今週の金曜日に伺いたいです。',
      '10日に伺いたいです。',
      // 見られますか, 見たい, 行けますか: with a boutique, a day or 実物
      '土曜日の14時に銀座で見られますか？',
      '実物を見たいです。',
      '来週、心斎橋のブティックに行けますか？',
      '明日、表参道で見られますか？',
    ];
    for (const text of asks) expect.soft(asksToVisit(text), text).toBe(true);
  });

  it('hears no Japanese request in 伺い or 見たい alone, or in a plain question', () => {
    const plain = ['伺いたいです。', 'お伺いしてもよろしいですか？', 'この色も見たいです。', '見られますか？', '行けますか？', 'こんにちは', '営業時間は何時からですか？', 'おすすめは何ですか？', '予約について教えてください。', 'ご来店ありがとうございます。'];
    for (const text of plain) expect.soft(asksToVisit(text), text).toBe(false);
  });

  it('lets a Japanese exclusion win over a request: whether a booking is needed, checking, changing or cancelling one, a pre-order, not coming in, or asking about something', () => {
    const excluded = [
      // the review's examples
      '予約を確認したいです',
      '予約をキャンセルしたい',
      // each exclusion, beside a request's words
      '予約は必要ですか？それとも来店できますか？',
      '来店したいのですが、予約が必要ですか？',
      '予約の確認と、別の日の予約をお願いします。',
      '予約を確認してから来店したいです。',
      '予約の変更をして、来店したいです。',
      '予約を変更して、来店したいです。',
      '来店の予約をキャンセルして、別の日に予約したいです。',
      '予約注文で予約したいです。',
      '予約販売の商品を予約したいです。',
      '来店しなくても予約できますか？',
      '来店せずに予約できますか？',
      '銀座のお店について伺いたいです。',
      '明日、銀座のお店にお伺いしたいことがあります。',
      // 伺う after を is "to ask about" something, even beside a place or a day
      '銀座店の営業時間を伺いたいです。',
      '表参道のお店の場所を伺いたいです。',
      '土曜日の営業時間を伺いたいです。',
      '銀座店の営業時間をお伺いしたいです。',
    ];
    for (const text of excluded) expect.soft(asksToVisit(text), text).toBe(false);
  });
});

