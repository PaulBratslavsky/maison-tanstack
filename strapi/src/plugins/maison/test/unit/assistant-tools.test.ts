import { describe, expect, it, vi } from 'vitest';
import { ACTION, ASSISTANT_LIMITS, INQUIRY_FILTERS, INQUIRY_KINDS } from '../../server/src/constants';
import { READ_TOOL_NAMES, TOOL_LABELS, assistantTools, toolLabel, type AssistantToolSpec } from '../../server/src/assistant/tools';
import { DATA_RULE } from '../../server/src/assistant/views';
import { fakeStrapi } from './fake-strapi';

type Doc = Record<string, any>;

/** An admin's ability: it says yes to the actions it was given, and keeps how it was asked. */
const abilityOf = (...granted: string[]) => ({ can: vi.fn((action: string) => granted.includes(action)) });
const READ_ACTIONS = [ACTION.appointmentsReview, ACTION.questionsRead, ACTION.inquiriesView, ACTION.catalogRead];

const toolsFor = (granted: string[], services: Record<string, unknown> = {}, config: Doc = {}) =>
  assistantTools(fakeStrapi({ services, config }), abilityOf(...granted));
const namesOf = (tools: AssistantToolSpec[]) => tools.map((tool) => tool.name);
const toolNamed = (tools: AssistantToolSpec[], name: string) => {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`The admin has no tool ${name}: ${namesOf(tools).join(', ')}`);
  return found;
};
const run = (tool: AssistantToolSpec, args: unknown = {}) => tool.execute!(args) as Promise<any>;

// Staff views as the services answer them: the customer masked, the LINE name and the staff's own work still on them.
const MASKED = 'line:Uab1…12';
const requestRow = (reference: string, fields: Doc = {}): Doc => ({
  reference,
  status: 'requested',
  customer: MASKED,
  boutique: { slug: 'ginza', name: 'Ginza Flagship' },
  requestedFor: '2026-10-10T14:00:00+09:00',
  products: [{ slug: 'weekender-50', name: 'Weekender 50' }],
  note: 'For my father.',
  createdVia: 'concierge',
  confirmationSent: true,
  demoCustomer: false,
  createdAt: '2026-10-05T16:30:00.000Z',
  ...fields,
});
const questionRow = (reference: string, fields: Doc = {}): Doc => ({
  reference,
  customer: MASKED,
  customerName: 'Aiko T.',
  question: 'Can the Weekender be monogrammed in gold?',
  reason: 'no_answer',
  language: 'en',
  product: null,
  status: 'open',
  staffName: 'Mika Sato',
  answer: null,
  createdAt: '2026-10-05T16:30:00.000Z',
  ...fields,
});
const inquiryRow = (documentId: string, fields: Doc = {}): Doc => ({
  documentId,
  createdAt: '2026-10-05T16:30:00.000Z',
  customer: MASKED,
  message: 'The strap on my Weekender came loose.',
  reply: 'I am sorry. I have passed this to the team.',
  language: 'en',
  product: null,
  knowledgeFound: false,
  handedOff: false,
  question: null,
  kind: 'complaint',
  sentimentScore: -0.7,
  sentimentLabel: 'negative',
  answered: false,
  reason: 'The strap failed within a month.',
  topic: 'strap repair',
  analysisStatus: 'analyzed',
  analysisAttempts: 1,
  humanCorrected: false,
  queue: 'complaint',
  status: 'open',
  closeReason: null,
  replyText: null,
  repliedAt: null,
  repliedBy: null,
  line: null,
  ...fields,
});
const ok = <T>(value: T) => ({ ok: true as const, value });
const refused = (code: string, message: string, hint: string) => ({ ok: false as const, code, message, hint });

describe('which tools an admin gets', () => {
  it.each([
    ['no permission at all', [], []],
    ['only the permission to use the assistant', [ACTION.assistantUse], []],
    ['only the permissions to confirm, reply and answer, which read nothing', [ACTION.appointmentsConfirm, ACTION.inquiriesReply, ACTION.questionsAnswer], []],
    ['reviewing requests', [ACTION.appointmentsReview], ['list_requests']],
    ['reading questions', [ACTION.questionsRead], ['list_questions']],
    ['viewing inquiries', [ACTION.inquiriesView], ['list_inquiries', 'inquiry_counts']],
    ['reading the catalog', [ACTION.catalogRead], ['search_knowledge', 'search_products', 'view_product']],
    ['reviewing requests and reading the catalog', [ACTION.catalogRead, ACTION.appointmentsReview], ['list_requests', 'search_knowledge', 'search_products', 'view_product']],
  ])('gives %s these tools: %j', (_what, granted, expected) => {
    expect(namesOf(toolsFor(granted as string[]))).toEqual(expected);
  });

  it('gives all seven read tools, in the order of READ_TOOL_NAMES, to an admin who can read everything', () => {
    expect(READ_TOOL_NAMES).toEqual(['list_requests', 'list_questions', 'list_inquiries', 'inquiry_counts', 'search_knowledge', 'search_products', 'view_product']);
    expect(namesOf(toolsFor(READ_ACTIONS))).toEqual([...READ_TOOL_NAMES]);
  });

  it('asks the ability about the action alone, never about a subject', () => {
    const ability = abilityOf(...READ_ACTIONS);
    assistantTools(fakeStrapi(), ability);
    expect(ability.can).toHaveBeenCalled();
    for (const call of ability.can.mock.calls) expect(call, JSON.stringify(call)).toHaveLength(1);
  });

  it('leaves out the catalog tools that disabledTools names, as MCP registration does, and keeps the staff tools', () => {
    const names = namesOf(toolsFor(READ_ACTIONS, {}, { disabledTools: ['search_products', 'view_product'] }));
    expect(names).toEqual(['list_requests', 'list_questions', 'list_inquiries', 'inquiry_counts', 'search_knowledge']);
  });

  it('does not let disabledTools take away a staff tool: it names the MCP tools, and these have their own permissions', () => {
    const names = namesOf(toolsFor(READ_ACTIONS, {}, { disabledTools: ['appointment_requests', 'confirm_appointment'] }));
    expect(names).toContain('list_requests');
  });

  it('offers no tool that writes: not confirming, answering, replying, closing, relabelling or any LINE tool', () => {
    const everything = { can: () => true };
    const names = namesOf(assistantTools(fakeStrapi(), everything));
    expect(names).toEqual([...READ_TOOL_NAMES]);
    for (const written of ['confirm_appointment', 'request_appointment', 'hand_off_to_staff', 'log_inquiry', 'pending_confirmations', 'record_confirmation']) {
      expect(names).not.toContain(written);
    }
  });

  it('gives every tool a description that ends with the data rule, and an input schema @tanstack/ai can turn into JSON Schema', () => {
    for (const tool of toolsFor(READ_ACTIONS)) {
      expect(tool.description.endsWith(DATA_RULE), tool.name).toBe(true);
      expect(tool.description.length, tool.name).toBeGreaterThan(DATA_RULE.length + 40);
      // @tanstack/ai reads zod 4's Standard JSON Schema; a zod 3 schema has none and would reach the model broken.
      const jsonSchema = (tool.inputSchema as any)['~standard'].jsonSchema.input({ target: 'draft-07' });
      expect(jsonSchema.type, tool.name).toBe('object');
    }
  });

  it('gives every read tool a server-side execute, since the model reads their answers', () => {
    for (const tool of toolsFor(READ_ACTIONS)) expect(tool.execute, tool.name).toBeTypeOf('function');
  });
});

describe('the inputs', () => {
  const tools = toolsFor(READ_ACTIONS);
  const accepts = (name: string, input: unknown) => toolNamed(tools, name).inputSchema.safeParse(input).success;

  it('takes no field for the lists and the counts but the ones in the spec, each one optional, and drops or refuses any other', () => {
    const fields: Record<string, string[]> = {
      list_requests: ['date', 'limit', 'reference', 'status'],
      list_questions: ['limit', 'reference', 'since', 'status'],
      list_inquiries: ['documentId', 'filter', 'kind', 'limit', 'since'],
      inquiry_counts: [],
    };
    for (const [name, expected] of Object.entries(fields)) {
      const schema = toolNamed(tools, name).inputSchema;
      expect(Object.keys(schema.shape).sort(), name).toEqual(expected);
      expect(accepts(name, {}), name).toBe(true);
      const unknown = schema.safeParse({ boutique: 'ginza', customer: 'line:Uab1…12' });
      // Either way the field never reaches a service: a refusal is no call, and a strip leaves no trace of it.
      if (unknown.success) expect(unknown.data, name).toEqual({});
      else expect(unknown.success, name).toBe(false);
    }
  });

  it('limits a list to 1 to 50 rows, whole numbers only', () => {
    for (const name of ['list_requests', 'list_questions', 'list_inquiries']) {
      expect(accepts(name, { limit: 1 }), name).toBe(true);
      expect(accepts(name, { limit: ASSISTANT_LIMITS.listRows }), name).toBe(true);
      for (const limit of [0, 51, -1, 1.5, '5']) expect(accepts(name, { limit }), `${name} ${String(limit)}`).toBe(false);
    }
  });

  it('takes the request statuses, a real visit day and an APT reference', () => {
    for (const status of ['requested', 'confirmed', 'all']) expect(accepts('list_requests', { status })).toBe(true);
    expect(accepts('list_requests', { status: 'pending' })).toBe(false);
    expect(accepts('list_requests', { date: '2026-10-10' })).toBe(true);
    for (const date of ['2026-10-1', '2026-09-31', 'tomorrow']) expect(accepts('list_requests', { date }), date).toBe(false);
    expect(accepts('list_requests', { reference: 'APT-4821' })).toBe(true);
    for (const reference of ['APT-481', 'Q-4821', 'apt-4821', '4821']) expect(accepts('list_requests', { reference }), reference).toBe(false);
  });

  it('takes the question statuses, a real since day and a Q reference', () => {
    for (const status of ['open', 'answered', 'all']) expect(accepts('list_questions', { status })).toBe(true);
    expect(accepts('list_questions', { status: 'taken' })).toBe(false);
    expect(accepts('list_questions', { since: '2026-10-06' })).toBe(true);
    for (const since of ['2026-02-30', '2026-10-6', 'yesterday']) expect(accepts('list_questions', { since }), since).toBe(false);
    expect(accepts('list_questions', { reference: 'Q-4821' })).toBe(true);
    for (const reference of ['Q-481', 'APT-4821', 'q-4821']) expect(accepts('list_questions', { reference }), reference).toBe(false);
  });

  it("takes the Inquiries tab's five filters, the four kinds, a real since day and a documentId of 1 to 64 characters", () => {
    for (const filter of INQUIRY_FILTERS) expect(accepts('list_inquiries', { filter }), filter).toBe(true);
    expect(accepts('list_inquiries', { filter: 'complaints' })).toBe(false);
    for (const kind of INQUIRY_KINDS) expect(accepts('list_inquiries', { kind }), kind).toBe(true);
    expect(accepts('list_inquiries', { kind: 'rant' })).toBe(false);
    expect(accepts('list_inquiries', { since: '2026-10-06' })).toBe(true);
    expect(accepts('list_inquiries', { since: '2026-13-01' })).toBe(false);
    expect(accepts('list_inquiries', { documentId: 'k3j9x0a8s7d6' })).toBe(true);
    expect(accepts('list_inquiries', { documentId: 'x'.repeat(64) })).toBe(true);
    for (const documentId of ['', '   ', 'x'.repeat(65)]) expect(accepts('list_inquiries', { documentId }), JSON.stringify(documentId)).toBe(false);
  });

  it('trims a documentId before it is looked up', () => {
    const parsed = toolNamed(tools, 'list_inquiries').inputSchema.parse({ documentId: '  abc123  ' });
    expect(parsed.documentId).toBe('abc123');
  });

  it('takes the catalog tools own inputs, from their MCP definitions', () => {
    expect(accepts('search_knowledge', { query: 'How do I care for the leather?' })).toBe(true);
    expect(accepts('search_knowledge', { query: '   ' })).toBe(false);
    expect(accepts('view_product', { slug: 'weekender-50' })).toBe(true);
    expect(accepts('view_product', { slug: 'Weekender 50' })).toBe(false);
    expect(accepts('search_products', { occasion: 'travel', limit: 8 })).toBe(true);
  });
});

describe('list_requests', () => {
  const tool = (listRequests: unknown, config: Doc = {}) => toolNamed(toolsFor([ACTION.appointmentsReview], { appointments: { listRequests } }, config), 'list_requests');

  it('asks for one row more than the limit, so it can tell whether there were more, and answers the first rows of the model views', async () => {
    const listRequests = vi.fn(async () => ok([requestRow('APT-1001'), requestRow('APT-1002'), requestRow('APT-1003')]));
    const answer = await run(tool(listRequests), { status: 'confirmed', date: '2026-10-10', limit: 2 });
    expect(listRequests).toHaveBeenCalledOnce();
    expect(listRequests).toHaveBeenCalledWith({ status: 'confirmed', date: '2026-10-10', limit: 3 });
    expect(answer.capped).toBe(true);
    expect(answer.requests.map((request: Doc) => request.reference)).toEqual(['APT-1001', 'APT-1002']);
    expect(answer.requests[0]).toMatchObject({ customer: MASKED, boutique: 'Ginza Flagship', pieces: ['Weekender 50'], note: '<customer_note>For my father.</customer_note>' });
    expect(answer.requests[0]).not.toHaveProperty('demoCustomer');
  });

  it('says capped: false when the rows fit, and has 50 as its default limit', async () => {
    const listRequests = vi.fn(async () => ok([requestRow('APT-1001')]));
    expect(await run(tool(listRequests))).toEqual({ requests: [expect.objectContaining({ reference: 'APT-1001' })], capped: false });
    expect(listRequests).toHaveBeenCalledWith({ limit: 51 });
  });

  it('can be capped at 50 rows: it asks for 51, and answers 50 of the 51 it gets', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => requestRow(`APT-${2000 + index}`));
    const listRequests = vi.fn(async () => ok(rows));
    for (const args of [{ limit: 50 }, {}]) {
      const answer = await run(tool(listRequests), args);
      expect(listRequests).toHaveBeenLastCalledWith({ limit: 51 });
      expect(answer.requests, JSON.stringify(args)).toHaveLength(50);
      expect(answer.capped, JSON.stringify(args)).toBe(true);
    }
  });

  it('says capped: false for exactly as many rows as the default limit', async () => {
    const rows = Array.from({ length: 50 }, (_, index) => requestRow(`APT-${2000 + index}`));
    const answer = await run(tool(vi.fn(async () => ok(rows))), {});
    expect(answer.requests).toHaveLength(50);
    expect(answer.capped).toBe(false);
  });

  it('answers an empty list, not an error, for a filter that matches nothing', async () => {
    expect(await run(tool(vi.fn(async () => ok([]))), { date: '2026-10-11' })).toEqual({ requests: [], capped: false });
  });

  it('cuts a long note in a list and says truncated, and keeps the whole note for one request by its reference', async () => {
    const long = 'n'.repeat(1000);
    const listRequests = vi.fn(async () => ok([requestRow('APT-4821', { note: long })]));
    const inList = await run(tool(listRequests), {});
    expect(inList.requests[0].truncated).toBe(true);
    expect(inList.requests[0].note.length).toBeLessThan(400);
    const single = await run(tool(listRequests), { reference: 'APT-4821' });
    expect(single.requests[0].note).toBe(`<customer_note>${long}</customer_note>`);
    expect(single.requests[0]).not.toHaveProperty('truncated');
    expect(listRequests).toHaveBeenLastCalledWith({ reference: 'APT-4821', limit: 51 });
  });

  it('reads times in the zone the plugin is set to: 16:30 UTC is 01:30 the next day in Tokyo, and stays 16:30 in UTC', async () => {
    const listRequests = vi.fn(async () => ok([requestRow('APT-1001')]));
    expect((await run(tool(listRequests), {})).requests[0].receivedAt).toBe('2026-10-06T01:30:00+09:00');
    expect((await run(tool(listRequests, { timezone: 'UTC' }), {})).requests[0].receivedAt).toBe('2026-10-05T16:30:00+00:00');
  });

  it('leaves the visit day out of the lookup when it is given a reference, so a request on another day is still found', async () => {
    // As the service answers: the day and the reference both apply, so a visit on the 10th is not on the 11th.
    const listRequests = vi.fn(async (filters: Doc) => ok(filters.date ? [] : [requestRow('APT-4821')]));
    const answer = await run(tool(listRequests), { reference: 'APT-4821', date: '2026-10-11' });
    expect(listRequests).toHaveBeenCalledOnce();
    expect(listRequests).toHaveBeenCalledWith({ reference: 'APT-4821', limit: 51 });
    expect(listRequests.mock.calls[0][0].date).toBeUndefined();
    expect(answer).toEqual({ requests: [expect.objectContaining({ reference: 'APT-4821' })], capped: false });
  });

  it('answers not_found for a reference no request has, never an empty list', async () => {
    const answer = await run(tool(vi.fn(async () => ok([]))), { reference: 'APT-4812' });
    expect(answer).toEqual({ error: { code: 'not_found', message: 'No request APT-4812.', hint: expect.stringContaining('list_requests') } });
    expect(answer).not.toHaveProperty('requests');
  });

  it('answers a failure of the service as { error }, and never throws it', async () => {
    const listRequests = vi.fn(async () => refused('not_found', 'No boutique "kyoto".', 'Call find_boutiques.'));
    await expect(run(tool(listRequests), {})).resolves.toEqual({ error: { code: 'not_found', message: 'No boutique "kyoto".', hint: 'Call find_boutiques.' } });
  });

  it('answers input the schema refuses as invalid_input, and never calls the service', async () => {
    const listRequests = vi.fn();
    const answer = await run(tool(listRequests), { reference: '4821' });
    expect(answer).toEqual({ error: { code: 'invalid_input', message: 'reference: Use a reference like APT-4821.', hint: expect.stringContaining('list_requests') } });
    expect(listRequests).not.toHaveBeenCalled();
  });
});

describe('list_questions', () => {
  const tool = (list: unknown) => toolNamed(toolsFor([ACTION.questionsRead], { questions: { list } }), 'list_questions');

  it('passes status, since and reference to the service with one row more than the limit', async () => {
    const list = vi.fn(async () => ok([questionRow('Q-1001'), questionRow('Q-1002')]));
    const answer = await run(tool(list), { status: 'all', since: '2026-10-06', limit: 1 });
    expect(list).toHaveBeenCalledWith({ status: 'all', since: '2026-10-06', limit: 2 });
    expect(answer.capped).toBe(true);
    expect(answer.questions).toHaveLength(1);
  });

  it('asks for 51 rows when it is given no limit, so 50 is its default', async () => {
    const list = vi.fn(async () => ok([questionRow('Q-1001')]));
    await run(tool(list), {});
    expect(list).toHaveBeenCalledWith({ limit: 51 });
  });

  it("answers the model's view of each question: no LINE display name, no staff name, no answer", async () => {
    const list = vi.fn(async () => ok([questionRow('Q-1001', { status: 'answered', answer: 'Yes, in gold or silver.' })]));
    const answer = await run(tool(list), {});
    expect(answer.questions[0]).toMatchObject({ reference: 'Q-1001', customer: MASKED, question: '<customer_question>Can the Weekender be monogrammed in gold?</customer_question>', why: 'no_answer' });
    const text = JSON.stringify(answer);
    for (const left of ['Aiko', 'Mika', 'Yes, in gold']) expect(text).not.toContain(left);
  });

  it('keeps the whole question for one question by its reference, and cuts it in a list', async () => {
    const long = 'q'.repeat(1000);
    const list = vi.fn(async () => ok([questionRow('Q-4821', { question: long })]));
    expect((await run(tool(list), {})).questions[0].truncated).toBe(true);
    const single = await run(tool(list), { reference: 'Q-4821' });
    expect(single.questions[0].question).toBe(`<customer_question>${long}</customer_question>`);
  });

  it('leaves the day out of the lookup when it is given a reference, so a question from an earlier day is still found', async () => {
    // As the service answers: since and the reference both apply, so a question from the 5th is not on or after the 6th.
    const list = vi.fn(async (filters: Doc) => ok(filters.since ? [] : [questionRow('Q-4821')]));
    const answer = await run(tool(list), { reference: 'Q-4821', since: '2026-10-06' });
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ reference: 'Q-4821', limit: 51 });
    expect(list.mock.calls[0][0].since).toBeUndefined();
    expect(answer).toEqual({ questions: [expect.objectContaining({ reference: 'Q-4821' })], capped: false });
  });

  it('answers not_found for a reference no question has, with the reference in the message, never an empty list', async () => {
    const answer = await run(tool(vi.fn(async () => ok([]))), { reference: 'Q-4812' });
    expect(answer).toEqual({ error: { code: 'not_found', message: 'No question Q-4812.', hint: expect.stringContaining('list_questions') } });
  });

  it('answers an empty list for a day with no questions', async () => {
    expect(await run(tool(vi.fn(async () => ok([]))), { since: '2026-10-06' })).toEqual({ questions: [], capped: false });
  });

  it('answers a failure of the service as { error }', async () => {
    const list = vi.fn(async () => refused('invalid_input', 'The date "x" is not a real date.', 'Use YYYY-MM-DD.'));
    await expect(run(tool(list), {})).resolves.toEqual({ error: { code: 'invalid_input', message: 'The date "x" is not a real date.', hint: 'Use YYYY-MM-DD.' } });
  });
});

describe('list_inquiries', () => {
  const tool = (services: Doc) => toolNamed(toolsFor([ACTION.inquiriesView], { inquiries: services }), 'list_inquiries');

  it('passes filter, kind and since to the service, so a complaint from the week counts whatever its status', async () => {
    const list = vi.fn(async () => ok([inquiryRow('k1')]));
    await run(tool({ list }), { filter: 'all', kind: 'complaint', since: '2026-10-06', limit: 10 });
    expect(list).toHaveBeenCalledWith({ filter: 'all', kind: 'complaint', since: '2026-10-06', limit: 11 });
  });

  it("answers the model's view of each inquiry, and nothing of staff's own work", async () => {
    const list = vi.fn(async () => ok([inquiryRow('k1', { status: 'replied', replyText: 'Staff wrote this.', repliedBy: 'Mika Sato', line: { outcome: 'sent', detail: null } })]));
    const answer = await run(tool({ list }), {});
    expect(answer.inquiries[0]).toMatchObject({ documentId: 'k1', customer: MASKED, kind: 'complaint', sentiment: 'negative', receivedAt: '2026-10-06T01:30:00+09:00' });
    const text = JSON.stringify(answer);
    for (const left of ['Staff wrote this', 'Mika', 'sentimentScore', 'analysisStatus']) expect(text).not.toContain(left);
  });

  it('caps at the limit, and says so: with no limit it asks for 51 rows and answers 50', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => inquiryRow(`k${index}`));
    const list = vi.fn(async () => ok(rows));
    const answer = await run(tool({ list }), {});
    expect(list).toHaveBeenCalledWith({ limit: 51 });
    expect(answer.inquiries).toHaveLength(50);
    expect(answer.capped).toBe(true);
  });

  it('looks one inquiry up by its documentId with its full text, and ignores the filters', async () => {
    const long = 'm'.repeat(1000);
    const view = vi.fn(async () => ok(inquiryRow('k1', { message: long })));
    const list = vi.fn();
    const answer = await run(tool({ list, view }), { documentId: 'k1', filter: 'praise', since: '2026-10-06' });
    expect(view).toHaveBeenCalledWith('k1');
    expect(list).not.toHaveBeenCalled();
    expect(answer).toEqual({ inquiries: [expect.objectContaining({ documentId: 'k1', message: `<customer_message>${long}</customer_message>` })], capped: false });
    expect(answer.inquiries[0]).not.toHaveProperty('truncated');
  });

  it('cuts the message in a list and says truncated', async () => {
    const list = vi.fn(async () => ok([inquiryRow('k1', { message: 'm'.repeat(1000), reply: 'r'.repeat(2000) })]));
    const answer = await run(tool({ list }), {});
    expect(answer.inquiries[0].truncated).toBe(true);
    expect(answer.inquiries[0].message.length).toBeLessThan(400);
    expect(answer.inquiries[0].conciergeReply.length).toBeLessThan(400);
  });

  it("answers the service's own not_found for a documentId that matches nothing, never an empty list", async () => {
    const view = vi.fn(async () => refused('not_found', 'No inquiry "k9".', 'Reload the Inquiries tab: it may have been deleted.'));
    const answer = await run(tool({ view }), { documentId: 'k9' });
    expect(answer).toEqual({ error: { code: 'not_found', message: 'No inquiry "k9".', hint: 'Reload the Inquiries tab: it may have been deleted.' } });
    expect(answer).not.toHaveProperty('inquiries');
  });

  it('answers an empty list, not an error, for a filter that matches nothing', async () => {
    expect(await run(tool({ list: vi.fn(async () => ok([])) }), { filter: 'complaint' })).toEqual({ inquiries: [], capped: false });
  });

  it('answers a failure of the service as { error }', async () => {
    const list = vi.fn(async () => refused('invalid_input', 'Unknown kind "rant".', 'Use one of question, complaint, praise, other.'));
    await expect(run(tool({ list }), {})).resolves.toEqual({ error: { code: 'invalid_input', message: 'Unknown kind "rant".', hint: 'Use one of question, complaint, praise, other.' } });
  });

  it('answers input the schema refuses as invalid_input, and never calls the service', async () => {
    const list = vi.fn();
    const answer = await run(tool({ list }), { filter: 'complaints' });
    expect(answer.error.code).toBe('invalid_input');
    expect(answer.error.message).toMatch(/^filter: /);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('inquiry_counts', () => {
  it('answers the four counts of the open inquiries, as the service gives them', async () => {
    const summary = vi.fn(async () => ({ needsAnswer: 4, complaint: 2, praise: 1, notLabelled: 3 }));
    const tool = toolNamed(toolsFor([ACTION.inquiriesView], { inquiries: { summary } }), 'inquiry_counts');
    expect(await run(tool)).toEqual({ needsAnswer: 4, complaint: 2, praise: 1, notLabelled: 3 });
    expect(summary).toHaveBeenCalledOnce();
  });
});

describe('the catalog tools', () => {
  const catalog = (methods: Doc, config: Doc = {}) => toolsFor([ACTION.catalogRead], { catalog: methods }, config);

  it('search_knowledge gives the MCP result as it is', async () => {
    const searchKnowledge = vi.fn(async () => ok({ entries: [{ title: 'Leather care', answer: 'Wipe with a dry cloth.', category: 'care', productSlugs: [] }] }));
    const answer = await run(toolNamed(catalog({ searchKnowledge }), 'search_knowledge'), { query: 'How do I care for the leather?', locale: 'en' });
    expect(answer).toEqual({ locale: 'en', entries: [{ title: 'Leather care', answer: 'Wipe with a dry cloth.', category: 'care', productSlugs: [] }] });
    expect(searchKnowledge).toHaveBeenCalledWith('en', { query: 'How do I care for the leather?', productSlugs: undefined });
  });

  it('search_products gives the MCP result as it is', async () => {
    const searchProducts = vi.fn(async () => ok({ total: 0, products: [] }));
    await expect(run(toolNamed(catalog({ searchProducts }), 'search_products'), { occasion: 'travel', locale: 'en' })).resolves.toEqual({ locale: 'en', total: 0, products: [] });
  });

  it('view_product gives the MCP result without the product images', async () => {
    const getProduct = vi.fn(async () => ({ slug: 'weekender-50', name: 'Weekender 50', priceJpy: 480000, images: [{ url: 'https://cms.example.test/a.jpg', alt: 'Front' }], stock: [] }));
    const answer = await run(toolNamed(catalog({ getProduct }), 'view_product'), { slug: 'weekender-50', locale: 'en' });
    expect(answer).toEqual({ product: { slug: 'weekender-50', name: 'Weekender 50', priceJpy: 480000, stock: [] } });
    expect(answer.product).not.toHaveProperty('images');
  });

  it('view_product answers the tool error for a slug that is not there, as { error }', async () => {
    const getProduct = vi.fn(async () => null);
    const answer = await run(toolNamed(catalog({ getProduct }), 'view_product'), { slug: 'no-such-bag' });
    expect(answer.error.code).toBe('not_found');
    expect(answer).not.toHaveProperty('product');
  });

  it('answers input the schema refuses as invalid_input, and never calls the service', async () => {
    const searchKnowledge = vi.fn();
    const answer = await run(toolNamed(catalog({ searchKnowledge }), 'search_knowledge'), { query: '' });
    expect(answer.error.code).toBe('invalid_input');
    expect(searchKnowledge).not.toHaveBeenCalled();
  });
});

describe('the tool labels', () => {
  it('are the labels the spec gives each read tool, as staff read them in the list of tools', () => {
    expect(TOOL_LABELS).toEqual({
      list_requests: 'Visit requests',
      list_questions: 'Customer questions',
      list_inquiries: 'Inquiries',
      inquiry_counts: 'Inquiry counts',
      search_knowledge: 'Product knowledge',
      search_products: 'Product search',
      view_product: 'Product details',
    });
  });

  // A tool added later must come with a label. This reads the tools an admin who can do everything is offered, not the list above.
  it('cover every tool an admin who may do everything is offered, so a new tool cannot arrive without one', () => {
    const everything = { can: () => true };
    for (const { name } of assistantTools(fakeStrapi(), everything)) expect(Object.keys(TOOL_LABELS), name).toContain(name);
  });

  it('give each tool a label of its own, in plain words: no tool name, no dash', () => {
    const labels = Object.values(TOOL_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).not.toMatch(/_|\u2014|\u2013/);
  });

  it('fall back to the tool name for a tool with no label, and never to something every object has', () => {
    expect(toolLabel('list_requests')).toBe('Visit requests');
    expect(toolLabel('something_new')).toBe('something_new');
    for (const name of ['toString', '__proto__', 'constructor']) expect(toolLabel(name), name).toBe(name);
  });
});
