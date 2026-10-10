import { toolError } from '../domain/tool-result';

/** Exposed so app-level tools return errors in the same shape as Maison's. */
export default () => ({ toolError });
