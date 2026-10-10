import type { ToolExecutionContext } from '@tanstack/ai';

import { foundNothing, pieceOfSearch, recordedQuestionOf, recordedResult, whyNothingWasRecorded, type RecordedQuestion } from './turn';

/**
 * What the two wrappers need from a tool: a name, a schema, and a function to run. A TanStack AI server tool fits it. A
 * tool with no function (a client tool) is left as it is.
 */
interface WrappableTool {
  name: string;
  inputSchema?: unknown;
  execute?: (input: any, context?: ToolExecutionContext) => unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `properties` of a tool's input schema, when it is a plain JSON Schema object that has them. */
const propertiesOf = (schema: unknown): Record<string, unknown> | undefined => (isObject(schema) && isObject(schema.properties) ? schema.properties : undefined);

/**
 * The Maison tools, with the conversation's locale for each tool whose input schema has one, when the model leaves it
 * out (or sends null or "", the local model's blanks). Rule 7 asks for it, but in an English chat a booking came back
 * without it, so in the catalog's default language: the card showed 銀座本店. A locale the model gives is kept. A tool
 * that takes no locale, or has nothing to run, is returned as it is. The tools given are not changed.
 */
export const withConversationLocale = <TOOL extends WrappableTool>(tools: readonly TOOL[], locale: 'ja' | 'en'): TOOL[] =>
  tools.map((tool) => {
    const execute = tool.execute;
    const properties = propertiesOf(tool.inputSchema);
    if (!execute || !properties || !Object.hasOwn(properties, 'locale')) return tool;
    const withLocale = (input: unknown) => (isObject(input) && (input.locale === undefined || input.locale === null || input.locale === '') ? { ...input, locale } : input);
    return { ...tool, execute: (input: unknown, context?: ToolExecutionContext) => execute(withLocale(input), context) };
  });

/** What the app records for staff when the knowledge search finds nothing (withAutoHandOff). */
export interface AutoHandOffContext {
  /** The customer's last message (lastQuestionOf): the question, as they wrote it. */
  question: string;
  /** The piece whose page the customer asked from (pieceSlugOf), or null. It is what the question is about unless the search names another (pieceOfSearch). */
  piece: string | null;
  /** The chat's language: the question's. */
  locale: 'ja' | 'en';
}

/**
 * Has the app's server record a question no entry answers for Maison's staff, whatever the model does. Rule 9 tells the
 * model to call hand_off_to_staff when search_knowledge finds nothing, but the local model searched, found nothing,
 * skipped the call and wrote that the question was with the advisors: nothing was recorded, so its words were false. So:
 * - A search that comes back whole with no entries makes the call itself, for the customer's last message (their own
 *   words, not the model's), reason "no_answer", about the piece the search was about (pieceOfSearch: the one it names,
 *   else the page's). When Strapi records it, the search's result carries what it recorded (structuredContent.handOff,
 *   which the chat shows as the hand-off note, lib/tool-view.ts) and a sentence that tells the model. When the call
 *   fails, the result is as Strapi gave it and the chat shows its plain note. Nothing in the chat says why, so the log
 *   does, unless the customer closed the chat meanwhile: the call was cut short then, and nothing failed.
 * - hand_off_to_staff records once a request: after a question is recorded, by the model's call or the app's, a later
 *   call is answered with it and doesn't reach Strapi. A call that failed doesn't count, so a retry does. The calls run
 *   one at a time, so the model's call and the app's, made in the same step, can't both record.
 * Each call to this function has a hand-off of its own, so none is shared between requests. The tools are returned as
 * they are when either one is missing (a token without the permission).
 */
export const withAutoHandOff = <TOOL extends WrappableTool>(tools: readonly TOOL[], context: AutoHandOffContext): readonly TOOL[] => {
  const searchTool = tools.find((tool) => tool.name === 'search_knowledge');
  const handOffTool = tools.find((tool) => tool.name === 'hand_off_to_staff');
  const runSearch = searchTool?.execute;
  const runHandOff = handOffTool?.execute;
  if (!searchTool || !handOffTool || !runSearch || !runHandOff) return tools;

  /** What Strapi recorded in this request, once something has. */
  let recorded: RecordedQuestion | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** Runs `task` once every one before it has finished, however it ended. */
  const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const searchAndHandOff = async (input: unknown, options?: ToolExecutionContext) => {
    const result = await runSearch(input, options);
    if (!foundNothing(result) || context.question === '') return result;
    /** Logs a failed hand-off, unless the customer closed the chat meanwhile: the call was cut short then, and nothing failed. */
    const logFailure = (what: string) => {
      if (!options?.abortSignal?.aborted) console.warn(`[concierge] The hand-off for a search that found nothing ${what}`);
    };
    return oneAtATime(async () => {
      if (recorded) return result;
      const productSlug = pieceOfSearch(input, context.piece);
      let answer: unknown;
      try {
        answer = await runHandOff({ question: context.question, reason: 'no_answer', ...(productSlug ? { productSlug } : {}), locale: context.locale }, options);
      } catch (error) {
        logFailure(`broke on the way: ${error instanceof Error ? error.message : String(error)}`);
        return result;
      }
      const question = recordedQuestionOf(answer);
      if (!question) {
        logFailure(`recorded nothing: ${whyNothingWasRecorded(answer)}`);
        return result;
      }
      recorded = question;
      return {
        ...result,
        content: [
          ...(Array.isArray(result.content) ? result.content : []),
          { type: 'text', text: `No entry answers this, so the question was passed to Maison's client advisors as ${question.reference}. Don't call hand_off_to_staff for it.` },
        ],
        structuredContent: { ...result.structuredContent, handOff: { reference: question.reference, question: context.question, product: question.product } },
      };
    });
  };

  const handOffOnce = (input: unknown, options?: ToolExecutionContext) =>
    oneAtATime(async () => {
      if (recorded) return recordedResult(recorded);
      const result = await runHandOff(input, options);
      recorded = recordedQuestionOf(result);
      return result;
    });

  return tools.map((tool) => {
    if (tool === searchTool) return { ...tool, execute: searchAndHandOff };
    if (tool === handOffTool) return { ...tool, execute: handOffOnce };
    return tool;
  });
};
