import { chooseVisitInput } from './concierge/local-tools';
import { tidyInput } from './concierge/resolve-date';

/**
 * A choose_visit call's input as the server read it. The message part keeps what the model wrote ("Ginza " or " 16:30"),
 * and the server checks the call after tidying it (tidyInput and chooseVisitInput, lib/concierge/local-tools.ts), so the
 * picker reads it the same way: its form then starts from the same values the server accepted. An input the schema
 * refuses is still tidied, and the picker's own rules (lib/visit-picker.ts) drop what they can't use. Nothing here is
 * server-only: both modules are already in the browser bundle.
 */
export const pickerInputOf = (input: unknown): unknown => {
  const parsed = chooseVisitInput.safeParse(input);
  return parsed.success ? parsed.data : tidyInput(input);
};
