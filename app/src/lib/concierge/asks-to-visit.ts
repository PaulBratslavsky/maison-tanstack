// Whether a customer's message asks for a new visit. Pure: the route's safety net for the visit picker reads it (lib/concierge/turn.ts).

/** A pattern from words: each space matches any run of spaces, and the match ignores case. */
const phrase = (...alternatives: string[]) => new RegExp(alternatives.join('|').replaceAll(' ', '\\s+'), 'i');
/** An apostrophe, straight or curly. */
const APOSTROPHE = "['’]";
/** The cities of Maison's boutiques. */
const CITY = '(?:ginza|omotesando|osaka|shinsaibashi)';
/** What a customer asks to see: "it", "these", or a piece by name ("the Cabin Case 55"). */
const PIECE = '(?:it|them|this|these|that|those|one|the [\\w-]+(?: [\\w-]+){0,3})';
/** Ways to ask for a visit: book, visit, schedule, reserve, make an appointment, come in, drop by, stop by, or see a piece in person, in store, at a boutique or in a boutique's city. */
const VISIT_VERB = `(?:book|visit|schedule|reserve|make (?:an? )?(?:appointment|booking|reservation)|come (?:in|by|over)|drop (?:in|by)|stop by|see ${PIECE} (?:in person|in(?:-| )store|in ${CITY}|at ${CITY}|at (?:the |your |a )?(?:${CITY} )?(?:boutique|store|shop)))`;
/**
 * A request for a visit in English, in the first person: "Can I", "Could we" or "May I", "I'd like to" or "we would
 * love to", "I want to", each followed by a way to ask for a visit; "let's book" or "let's schedule"; or "book it",
 * "book one", "book a visit" or "book an appointment".
 */
const ASKS_TO_VISIT = phrase(
  `\\b(?:(?:can|could|may) (?:i|we)|(?:i${APOSTROPHE}d|i would|we${APOSTROPHE}d|we would) (?:like|love) to|(?:i|we) want to) (?:please |also |just )?${VISIT_VERB}\\b`,
  `\\blet${APOSTROPHE}s (?:book|schedule)\\b`,
  `\\bbook (?:it|one|a visit|an appointment)\\b`
);
/**
 * What makes an English message something other than a request for a new visit, whatever else it says: a visit already
 * asked for ("my booking"); cancelling, changing, moving, confirming or checking one, or its status; a policy, a cost,
 * free, a fee or a charge; whether one is needed; a no; visiting hours; or a table, restaurant, hotel, taxi or flight.
 */
const NOT_A_REQUEST = phrase(
  '\\b(?:my|our) (?:(?:next|upcoming|current|existing|last|previous|first) )?(?:visit|booking|appointment|reservation|request)s?\\b',
  '\\b(?:cancel(?:s|led|ed|ling|ing|lation)?|chang(?:e|es|ed|ing)|reschedul(?:e|es|ed|ing)|mov(?:e|es|ed|ing)|confirm(?:s|ed|ing|ation)?|check(?:s|ed|ing)?|status)\\b',
  '\\b(?:polic(?:y|ies)|costs?|free|fees?|charg(?:e|es|ed|ing))\\b',
  '\\b(?:need(?:s|ed)?|ha(?:ve|s|d)) to\\b',
  '\\brequired\\b',
  `\\b(?:don${APOSTROPHE}?t|do not|can${APOSTROPHE}?t|cannot|not now)\\b`,
  '\\bno,? thank(?:s| you)\\b',
  '\\bvisiting hours\\b',
  '\\b(?:table|restaurant|hotel|taxi|flight)s?\\b'
);
/** A request for a visit in Japanese, on its own: I'd like to book (予約したい), can I book (予約できますか), I'd like to come (来店したい), I'd like to go and see (見に行きたい). */
const ASKS_TO_VISIT_JA = /予約を?したい|予約できますか|予約をお願い|予約させて|来店したい|来店できますか|見に行きたい|見に行っても/;
/** Calling on the boutique (伺いたい, お伺いしても, お伺いしたい), which asks for a visit only beside a place or a day (JA_PLACE_OR_DAY). */
const CALLS_ON_JA = /伺いたい|お伺いしても|お伺いしたい/;
/** Seeing or going (見られますか, 見たい, 行けますか), which asks for a visit only beside a boutique, a day or the piece itself (実物). */
const SEES_JA = /見られますか|見たい|行けますか/;
/** A boutique, a place in one, or a day. */
const JA_PLACE_OR_DAY = /店舗|ブティック|お店|銀座|表参道|心斎橋|大阪|曜日|明日|来週|今週|日に/;
/**
 * What makes a Japanese message something other than a request for a new visit: whether a booking is needed (予約は必要),
 * checking, changing or cancelling one, a pre-order (予約注文, 予約販売), not coming in (来店しなくても), or asking about
 * something (について伺い, 伺いしたいこと).
 */
const NOT_A_REQUEST_JA = /予約は必要|予約が必要|予約の確認|予約を確認|予約の変更|予約を変更|キャンセル|予約注文|予約販売|来店しなくても|来店せず|について伺い|伺いしたいこと|を伺い|をお伺い/;

/**
 * Whether a customer's message asks for a new visit, in the words of a request, in English or Japanese: the first
 * condition of the visit picker's safety net (the concierge route). A plain question about hours or a product ("What time do
 * you open?", "When is a good time to come in?", "What do you have?") doesn't, and the exclusions win over a request's
 * words: a question about a visit already asked for ("Can I cancel my appointment?", 予約を確認したいです) would
 * otherwise get a fresh picker, and Send request would book a second visit. The Japanese words that need a place or a
 * day need it in the same sentence.
 */
export const asksToVisit = (text: string): boolean => {
  if (NOT_A_REQUEST.test(text) || NOT_A_REQUEST_JA.test(text)) return false;
  if (ASKS_TO_VISIT.test(text) || ASKS_TO_VISIT_JA.test(text)) return true;
  return text
    .split(/[。．！？!?\n]/)
    .some((sentence) => (CALLS_ON_JA.test(sentence) && JA_PLACE_OR_DAY.test(sentence)) || (SEES_JA.test(sentence) && (JA_PLACE_OR_DAY.test(sentence) || sentence.includes('実物'))));
};
