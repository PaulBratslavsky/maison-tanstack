export type ErrorCode =
  | 'not_signed_in'
  | 'not_found'
  | 'invalid_input'
  | 'boutique_closed'
  | 'in_the_past'
  | 'too_many_open_requests'
  | 'too_many_open_questions'
  | 'already_closed'
  | 'already_replied'
  | 'not_failed'
  | 'not_published'
  | 'not_configured'
  // Only the REST door answers this one: checking a customer's session failed on the server.
  | 'temporarily_unavailable'
  // Only the demo buttons answer this one: a load is still running in the background from the last press.
  | 'already_loading';

export interface ToolErrorResult {
  isError: true;
  content: [{ type: 'text'; text: string }];
}

export interface ToolSuccessResult<T extends Record<string, unknown>> {
  content: [{ type: 'text'; text: string }];
  structuredContent: T;
}

/** An expected failure the agent can recover from. Never thrown: returned from the handler. */
export const toolError = (code: ErrorCode, message: string, hint: string): ToolErrorResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message, hint } }) }],
});

export const toolSuccess = <T extends Record<string, unknown>>(data: T): ToolSuccessResult<T> => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});
