/**
 * What POST /maison/demo/seed answers (the seed service's SeedResult): `knowledge` is the English product knowledge
 * entries it added, and `knowledgeJa` the Japanese versions.
 */
export type SeedResult = {
  created: boolean;
  collections: number;
  products: number;
  boutiques: number;
  stockLevels: number;
  knowledge: number;
  knowledgeJa: number;
};

/** "a, b and c": a list joined with commas, and "and" before its last item. */
const andList = (parts: string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "1 question", "0 questions": the singular for exactly one. */
const counted = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

/** The product knowledge added, by language: "16 product knowledge entries in English", "16 in Japanese". */
const knowledgeAdded = ({ knowledge, knowledgeJa }: SeedResult): string[] => {
  const entries = (count: number) => counted(count, 'product knowledge entry', 'product knowledge entries');
  const added = knowledge > 0 ? [`${entries(knowledge)} in English`] : [];
  if (knowledgeJa > 0) added.push(`${added.length > 0 ? knowledgeJa : entries(knowledgeJa)} in Japanese`);
  return added;
};

/** The notice after Load demo catalog. */
export const describeSeed = (result: SeedResult): string => {
  const knowledge = knowledgeAdded(result);
  if (result.created) {
    const loaded = [`${result.products} products`, `${result.collections} collections`, `${result.boutiques} boutiques`, `${result.stockLevels} stock levels`];
    return `Loaded ${andList([...loaded, ...knowledge])}.`;
  }
  return knowledge.length > 0
    ? `The demo catalog is already loaded. Added ${andList(knowledge)}.`
    : 'The demo catalog and its product knowledge are already loaded.';
};

/** What POST /maison/demo/reset answers (the seed service's resetDemoAppointments): what it deleted. */
export type ResetResult = { appointments: number; notifications: number; questions: number; inquiries: number; knowledge: number };

/** The notice after Reset demo activity. */
export const describeReset = (result: ResetResult): string =>
  `Deleted ${andList([
    counted(result.appointments, 'appointment', 'appointments'),
    counted(result.notifications, 'notification', 'notifications'),
    counted(result.questions, 'question', 'questions'),
    counted(result.inquiries, 'inquiry', 'inquiries'),
    counted(result.knowledge, 'product knowledge entry', 'product knowledge entries'),
  ])}.`;

/** What POST /maison/demo/activity answers (the seed service's ActivityResult): all zeros, with `created` false, when it was there already. */
export type ActivityResult = { created: boolean; customers: number; appointments: number; confirmed: number; questions: number; inquiries: number };

/** The notice after Load demo activity. */
export const describeActivity = (result: ActivityResult): string =>
  result.created
    ? `Loaded ${andList([
        `${counted(result.appointments, 'request', 'requests')} (${result.confirmed} confirmed)`,
        counted(result.questions, 'question', 'questions'),
        counted(result.inquiries, 'inquiry', 'inquiries'),
      ])} from ${counted(result.customers, 'made-up customer', 'made-up customers')}.`
    : 'The demo activity is already loaded. Reset demo activity first to load it again.';

/*
 * What the Demo data buttons show for an answer. Load demo catalog and Load demo activity answer 202 with
 * `started: true` when they go on in the background, and 200 with what they did when there was nothing to add. The
 * admin's fetch client gives the page the body, never the status. A body that isn't JSON, such as the HTML page Strapi
 * Cloud's proxy answers when a request takes too long, comes back as {} for a 200, and as a JSON parse error otherwise.
 */

/** A notice, as Strapi's useNotification shows it. */
export type DemoNotice = { type: 'success' | 'info' | 'warning' | 'danger'; message: string };

/** What each button posts to: Load demo catalog, Load demo activity and Reset demo activity. */
export type DemoAction = 'seed' | 'activity' | 'reset';

/** What Load demo activity's 202 says while it adds the rows. */
export const ACTIVITY_LOADING = 'Loading demo activity: the lists fill in over the next few seconds.';

/** What a button shows for an answer that isn't JSON: the work may still be finishing, and the lists poll by themselves. */
export const TOO_SLOW = 'Strapi took too long to answer. Wait a few seconds: the lists refresh by themselves.';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const counts = (value: Record<string, unknown>, keys: readonly string[]): boolean => keys.every((key) => Number.isInteger(value[key]));

const SEED_COUNTS = ['collections', 'products', 'boutiques', 'stockLevels', 'knowledge', 'knowledgeJa'] as const;
const ACTIVITY_COUNTS = ['customers', 'appointments', 'confirmed', 'questions', 'inquiries'] as const;
const RESET_COUNTS = ['appointments', 'notifications', 'questions', 'inquiries', 'knowledge'] as const;

/** Whether an answer says the work goes on in the background: a 202's `started: true`. The page then reloads its lists a few seconds later too. */
export const isStarted = (answer: unknown): boolean => isRecord(answer) && answer.started === true;

/** "Loading demo catalog in the background: 16 product knowledge entries in Japanese. It takes up to a minute." */
const describeSeedStarted = (answer: Omit<SeedResult, 'created'>): string => {
  const parts = [
    ...(answer.products > 0 ? [`${answer.products} products`] : []),
    ...(answer.collections > 0 ? [`${answer.collections} collections`] : []),
    ...(answer.boutiques > 0 ? [`${answer.boutiques} boutiques`] : []),
    ...(answer.stockLevels > 0 ? [`${answer.stockLevels} stock levels`] : []),
    ...knowledgeAdded({ ...answer, created: false }),
  ];
  return `Loading demo catalog in the background: ${andList(parts)}. It takes up to a minute.`;
};

/**
 * The notice a button shows for its answer: what was done, as before, or for a 202 that the work goes on in the
 * background. An answer that is none of these, as an HTML page comes back, shows TOO_SLOW instead of anything raw.
 */
export const demoNotice = (action: DemoAction, answer: unknown): DemoNotice => {
  const tooSlow: DemoNotice = { type: 'warning', message: TOO_SLOW };
  if (!isRecord(answer)) return tooSlow;
  if (action === 'activity') {
    if (isStarted(answer)) return { type: 'info', message: ACTIVITY_LOADING };
    return counts(answer, ACTIVITY_COUNTS) && typeof answer.created === 'boolean'
      ? { type: 'success', message: describeActivity(answer as ActivityResult) }
      : tooSlow;
  }
  if (action === 'seed') {
    if (!counts(answer, SEED_COUNTS)) return tooSlow;
    if (isStarted(answer)) return { type: 'info', message: describeSeedStarted(answer as Omit<SeedResult, 'created'>) };
    return typeof answer.created === 'boolean' ? { type: 'success', message: describeSeed(answer as SeedResult) } : tooSlow;
  }
  return counts(answer, RESET_COUNTS) ? { type: 'success', message: describeReset(answer as ResetResult) } : tooSlow;
};

/** Whether a failure is a body that isn't JSON. The name holds across realms, where `instanceof SyntaxError` doesn't; the words are the browser's. */
const isNotJson = (error: unknown): boolean => {
  const { name, message } = (isRecord(error) || error instanceof Error ? error : {}) as { name?: unknown; message?: unknown };
  return name === 'SyntaxError' || (typeof message === 'string' && /is not valid JSON|Unexpected token/.test(message));
};

/** The code in Strapi's error body, which the admin's fetch client keeps on the error's `response`. */
const codeOf = (error: unknown): unknown => (error as { response?: { data?: { error?: { details?: { code?: unknown } } } } })?.response?.data?.error?.details?.code;

/**
 * The notice a button shows when the press failed: TOO_SLOW for an answer that isn't JSON, the server's own words as
 * an info notice when a load is still running from the last press, and otherwise "That didn't work", with the server's
 * words, as before.
 */
export const demoErrorNotice = (error: unknown): DemoNotice => {
  if (isNotJson(error)) return { type: 'warning', message: TOO_SLOW };
  const message = error instanceof Error ? error.message : String(error);
  if (codeOf(error) === 'already_loading') return { type: 'info', message };
  return { type: 'danger', message: `That didn't work: ${message}` };
};
