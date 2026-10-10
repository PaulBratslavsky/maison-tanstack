import { EventType, chat, convertSchemaToJsonSchema, maxIterations, type StreamChunk } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';

import { CHOOSE_VISIT } from '../visit-picker';
import { CHOOSE_VISIT_DESCRIPTION, chooseVisitTool, resolveDateTool } from './local-tools';
import { RESOLVE_DATE_DESCRIPTION } from './resolve-date';
import { scriptedModel, toolContext, type Step } from './test-support';

/** A Wednesday in Tokyo: "Saturday" is the 10th. */
const NOW = new Date('2026-10-07T03:00:00Z');

/** Runs the script on a real chat() with `tools`: the stream, and what the model was asked each time. */
const converse = async (steps: Step[], tools: Parameters<typeof chat>[0]['tools']) => {
  const model = scriptedModel(steps);
  const chunks: StreamChunk[] = [];
  for await (const chunk of chat({ adapter: model.adapter as never, messages: [{ role: 'user', content: 'Hello' }], tools, agentLoopStrategy: maxIterations(8), debug: false }) as AsyncIterable<StreamChunk>) chunks.push(chunk);
  const results = chunks.filter((chunk) => chunk.type === EventType.TOOL_CALL_RESULT) as unknown as Array<{ toolCallId: string; content: string; metadata?: { tanstack?: { state?: string } } }>;
  const waiting = chunks.find((chunk) => chunk.type === EventType.RUN_FINISHED && (chunk as { outcome?: { type?: string } }).outcome?.type === 'interrupt') as unknown as
    | { outcome: { interrupts: Array<{ toolCallId: string; metadata: { toolName: string; input: unknown } }> } }
    | undefined;
  return { model, chunks, results, waiting };
};

describe('resolve_date', () => {
  const tool = resolveDateTool('en', NOW);
  const schema = convertSchemaToJsonSchema(tool.inputSchema as never) as { properties: Record<string, unknown>; additionalProperties?: boolean };

  it('is a server tool with the description the instructions rely on, and a strict schema', () => {
    expect(tool.name).toBe('resolve_date');
    expect(tool.description).toBe(RESOLVE_DATE_DESCRIPTION);
    expect(typeof tool.execute).toBe('function');
    expect(Object.keys(schema.properties).sort()).toEqual(['date', 'relative', 'week', 'weekday']);
    expect(schema.additionalProperties).toBe(false);
  });

  it("answers from Tokyo's calendar, in the reply language", async () => {
    expect(await tool.execute!({ weekday: 'saturday' }, toolContext())).toEqual({ date: '2026-10-10', weekday: 'Saturday', isPast: false });
    expect(await resolveDateTool('ja', NOW).execute!({ relative: 'tomorrow' }, toolContext())).toEqual({ date: '2026-10-08', weekday: '木曜日', isPast: false });
  });

  it("tidies the model's input: case and spaces don't count, blanks and nulls are not given, and a locale is ignored", async () => {
    const { results } = await converse(
      [{ calls: [{ id: 'c1', name: 'resolve_date', input: { weekday: ' Saturday ', week: 'NEXT', date: '', relative: null, locale: 'en' } }] }, { words: 'Done.' }],
      [tool]
    );
    expect(JSON.parse(results[0].content)).toEqual({ date: '2026-10-17', weekday: 'Saturday', isPast: false });
  });

  it("refuses a key it doesn't have, with the key's name, so a day can't be quietly dropped; the model is told and answers", async () => {
    const { results, model } = await converse([{ calls: [{ id: 'c1', name: 'resolve_date', input: { weekday: 'saturday', when: 'next' } }] }, { words: 'Sorry.' }], [tool]);
    expect(results[0].metadata?.tanstack?.state).toBe('output-error');
    expect(results[0].content).toContain('when');
    expect(model.modelCalls()).toBe(2);
  });

  it('refuses input that names more than one day, and tells the model why', async () => {
    const { results } = await converse([{ calls: [{ id: 'c1', name: 'resolve_date', input: { weekday: 'saturday', relative: 'tomorrow' } }] }, { words: 'Sorry.' }], [tool]);
    expect(results[0].metadata?.tanstack?.state).toBe('output-error');
    expect(results[0].content).toContain('Give exactly one of weekday, date or relative');
  });

  it('gives the model an error, not a stopped turn, for a date that is not on the calendar', async () => {
    const { results, model } = await converse([{ calls: [{ id: 'c1', name: 'resolve_date', input: { date: '2026-02-30' } }] }, { words: 'Sorry.' }], [tool]);
    expect(results[0].metadata?.tanstack?.state).toBe('output-error');
    expect(model.modelCalls()).toBe(2);
  });
});

describe('choose_visit', () => {
  const named = { productSlugs: ['weekender-50'], boutique: 'ginza', date: '2026-10-10', time: '14:00' };
  const schema = convertSchemaToJsonSchema(chooseVisitTool.inputSchema as never) as { properties: Record<string, any>; additionalProperties?: boolean; required?: string[] };

  it('is a client tool: it has no function to run on the server', () => {
    expect(chooseVisitTool.name).toBe(CHOOSE_VISIT);
    expect(chooseVisitTool.description).toBe(CHOOSE_VISIT_DESCRIPTION);
    expect(chooseVisitTool.__toolSide).toBe('client');
    expect('execute' in chooseVisitTool).toBe(false);
  });

  it('takes 1 to 5 product slugs and, when the customer named them, a boutique, a date and a time: nothing else', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(['boutique', 'date', 'productSlugs', 'time']);
    expect(schema.required).toEqual(['productSlugs']);
    expect(schema.properties.productSlugs).toMatchObject({ type: 'array', minItems: 1, maxItems: 5 });
    expect(schema.additionalProperties).toBe(false);
  });

  it("ends the turn at the call: the browser is asked to answer it, and the model isn't called again", async () => {
    const { model, waiting, results } = await converse([{ words: 'Here is the picker.', calls: [{ id: 'call-1', name: CHOOSE_VISIT, input: named }] }, { words: 'Never said.' }], [chooseVisitTool]);
    expect(model.modelCalls()).toBe(1);
    expect(results).toEqual([]);
    expect(waiting?.outcome.interrupts).toMatchObject([{ toolCallId: 'call-1', metadata: { toolName: CHOOSE_VISIT, input: named } }]);
  });

  it("tidies the input as resolve_date's: blanks and nulls are not given, case and spaces don't count, and a locale is ignored", async () => {
    const sent = { productSlugs: ['weekender-50', 'cabin-case-55'], boutique: ' Ginza ', date: '', time: null, locale: 'en' };
    const { waiting } = await converse([{ calls: [{ id: 'call-1', name: CHOOSE_VISIT, input: sent }] }], [chooseVisitTool]);
    expect(waiting?.outcome.interrupts[0].metadata.input).toStrictEqual({ productSlugs: ['weekender-50', 'cabin-case-55'], boutique: 'ginza' });
  });

  it("refuses input it can't take, with the reason, so the model calls again: no picker shows for it", async () => {
    const refused = [
      {}, // no pieces
      { productSlugs: [] },
      { productSlugs: ['a', 'b', 'c', 'd', 'e', 'f'] }, // six
      { productSlugs: 'weekender-50' }, // not a list
      { productSlugs: ['Weekender 50'] }, // a name, not a slug
      { productSlugs: ['weekender-50'], boutique: 'Ginza Flagship' },
      { productSlugs: ['weekender-50'], date: '10 October' },
      { productSlugs: ['weekender-50'], time: '2 pm' },
      { productSlugs: ['weekender-50'], time: '14:00:00' },
      { productSlugs: ['weekender-50'], time: '24:00' }, // the 24-hour clock ends at 23:59
      { productSlugs: ['weekender-50'], note: 'For my father.' }, // a key it doesn't have
    ];
    for (const input of refused) {
      const { model, waiting, results } = await converse([{ calls: [{ id: 'call-1', name: CHOOSE_VISIT, input }] }, { words: 'Sorry.' }], [chooseVisitTool]);
      expect(waiting, JSON.stringify(input)).toBeUndefined();
      expect(results[0].metadata?.tanstack?.state, JSON.stringify(input)).toBe('output-error');
      expect(model.modelCalls(), `${JSON.stringify(input)}: the model is told why, and answers`).toBe(2);
    }
  });
});
