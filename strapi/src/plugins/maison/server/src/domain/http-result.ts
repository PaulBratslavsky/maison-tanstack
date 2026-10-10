import type { ErrorCode } from './tool-result';

/**
 * The HTTP status of each expected failure on the REST routes.
 * 409: the request conflicts with how things stand now (the boutique's hours, the customer's open requests or
 * questions, a confirmation, an inquiry that is closed or replied to already, or didn't fail, or a demo load that is
 * still running). 422: it can't succeed as
 * sent, because time only moves forward. 503: the server can't check who is calling, because customer sign-in isn't
 * configured, or because checking failed this time.
 */
const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_signed_in: 401,
  not_found: 404,
  boutique_closed: 409,
  too_many_open_requests: 409,
  too_many_open_questions: 409,
  already_closed: 409,
  already_replied: 409,
  not_failed: 409,
  not_published: 409,
  already_loading: 409,
  in_the_past: 422,
  not_configured: 503,
  temporarily_unavailable: 503,
};

export const httpStatus = (code: ErrorCode): number => STATUS[code];

export interface HttpErrorBody {
  error: { code: ErrorCode; message: string; hint?: string };
}

/** A failure as the REST routes answer it: its status, and the code, message and hint the MCP tool would return. */
export const httpError = (code: ErrorCode, message: string, hint?: string): { status: number; body: HttpErrorBody } => ({
  status: httpStatus(code),
  body: { error: { code, message, ...(hint ? { hint } : {}) } },
});
