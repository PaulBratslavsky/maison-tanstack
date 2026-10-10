import type { ErrorCode } from './tool-result';

export type ServiceFailure = { ok: false; code: ErrorCode; message: string; hint: string };
export type ServiceResult<T> = { ok: true; value: T } | ServiceFailure;

/** Services return expected failures as values; tools turn them into toolError results. */
export const failure = (code: ErrorCode, message: string, hint: string): ServiceFailure => ({ ok: false, code, message, hint });
