import type { InquiryKind, InquiryQueue } from '../constants';

export interface QueueFacts {
  handedOff: boolean;
  kind: InquiryKind | null;
  answered: boolean | null;
}

/**
 * The spec's queue rule, in code and never by the model: a hand-off or a question nobody has said was answered needs an
 * answer. `answered` is null only for a person's label (the model always gives a boolean, and a logged turn has no kind),
 * and a question a person labelled has no answer to its name: when in doubt, a person sees it.
 */
export const queueFor = ({ handedOff, kind, answered }: QueueFacts): InquiryQueue => {
  if (handedOff) return 'needs-answer';
  if (kind === 'question' && answered !== true) return 'needs-answer';
  if (kind === 'complaint') return 'complaint';
  if (kind === 'praise') return 'praise';
  return 'none';
};
