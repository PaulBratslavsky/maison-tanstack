import { notSignedIn as notSignedInFailure } from '../domain/failures';
import { toolError } from '../domain/tool-result';

export const notSignedIn = () => {
  const { code, message, hint } = notSignedInFailure();
  return toolError(code, message, hint);
};
