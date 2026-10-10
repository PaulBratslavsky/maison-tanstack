import { describe, expect, it } from 'vitest';
import { INQUIRY_KINDS } from '../../server/src/constants';
import { queueFor } from '../../server/src/domain/inquiry-queue';

// Every kind and no kind, and every answer and none: the rule must not depend on what the labeller left out.
const KINDS = [...INQUIRY_KINDS, null] as const;
const ANSWERS = [true, false, null] as const;

describe('queueFor', () => {
  it('sends a hand-off to needs-answer, whatever the labels say or leave out', () => {
    for (const kind of KINDS) {
      for (const answered of ANSWERS) expect(queueFor({ handedOff: true, kind, answered }), `${kind} ${answered}`).toBe('needs-answer');
    }
  });

  it('sends a question that was not answered to needs-answer', () => {
    expect(queueFor({ handedOff: false, kind: 'question', answered: false })).toBe('needs-answer');
  });

  it('keeps an answered question out of the queues', () => {
    expect(queueFor({ handedOff: false, kind: 'question', answered: true })).toBe('none');
  });

  // Only a person's label leaves `answered` null: the model always gives a boolean, and a logged turn has no kind. A person who
  // labels a row Question (with AI off, the only way to label at all) has no `answered` to give, and the row must not leave every queue.
  it('sends a question nobody has said was answered to needs-answer: when in doubt, a person sees it', () => {
    expect(queueFor({ handedOff: false, kind: 'question', answered: null })).toBe('needs-answer');
  });

  it('sends a complaint to the complaint queue, answered or not', () => {
    for (const answered of ANSWERS) expect(queueFor({ handedOff: false, kind: 'complaint', answered }), `${answered}`).toBe('complaint');
  });

  it('sends praise to the praise queue, answered or not', () => {
    for (const answered of ANSWERS) expect(queueFor({ handedOff: false, kind: 'praise', answered }), `${answered}`).toBe('praise');
  });

  it('keeps anything else out of the queues, answered or not', () => {
    for (const answered of ANSWERS) expect(queueFor({ handedOff: false, kind: 'other', answered }), `${answered}`).toBe('none');
  });

  it('keeps a turn that has no labels yet out of the queues', () => {
    expect(queueFor({ handedOff: false, kind: null, answered: null })).toBe('none');
  });
});
