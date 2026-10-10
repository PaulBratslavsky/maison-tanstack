/**
 * The largest request body the app's server reads. A chat turn is a few kB. A longer body is refused with 413 before any
 * more of it is read, so the server never holds more than this of one in memory.
 */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The request's body, or null when it is longer than `limit` bytes: by its Content-Length, before reading any of it, or
 * as it arrives, for a body that has none (chunked) or is longer than it says. It throws when the body can't be read to
 * its end (the caller went away).
 */
export const readBody = async (request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (Number(request.headers.get('content-length')) > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks, size);
};

/** A customer's session, as the token exchange issues it: the only credential the app sends to Strapi. */
export const isCustomerSession = (authorization: string | null): boolean => /^Bearer mcp_at_\S+$/.test(authorization ?? '');
