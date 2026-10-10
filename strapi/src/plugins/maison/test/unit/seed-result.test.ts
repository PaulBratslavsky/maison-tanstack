import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LOADING,
  TOO_SLOW,
  demoErrorNotice,
  demoNotice,
  describeActivity,
  describeReset,
  describeSeed,
  isStarted,
} from '../../admin/src/seed-result';

const nothing = { created: false, collections: 0, products: 0, boutiques: 0, stockLevels: 0, knowledge: 0, knowledgeJa: 0 };
const firstLoad = { created: true, collections: 3, products: 12, boutiques: 3, stockLevels: 36 };

describe('describeSeed', () => {
  it('names everything a first load created, the product knowledge in English and in Japanese', () => {
    expect(describeSeed({ ...firstLoad, knowledge: 16, knowledgeJa: 16 })).toBe(
      'Loaded 12 products, 3 collections, 3 boutiques, 36 stock levels, 16 product knowledge entries in English and 16 in Japanese.'
    );
  });

  it('keeps the "and" before the last count when the product knowledge was there already', () => {
    expect(describeSeed({ ...firstLoad, knowledge: 0, knowledgeJa: 0 })).toBe('Loaded 12 products, 3 collections, 3 boutiques and 36 stock levels.');
  });

  it('says when only the product knowledge was added, in both languages', () => {
    expect(describeSeed({ ...nothing, knowledge: 16, knowledgeJa: 16 })).toBe(
      'The demo catalog is already loaded. Added 16 product knowledge entries in English and 16 in Japanese.'
    );
  });

  it('says when only the Japanese versions were added, as on a Strapi that had the English product knowledge', () => {
    expect(describeSeed({ ...nothing, knowledgeJa: 16 })).toBe('The demo catalog is already loaded. Added 16 product knowledge entries in Japanese.');
  });

  it('says "1 product knowledge entry" for one, in either language', () => {
    expect(describeSeed({ ...nothing, knowledgeJa: 1 })).toBe('The demo catalog is already loaded. Added 1 product knowledge entry in Japanese.');
    expect(describeSeed({ ...nothing, knowledge: 1, knowledgeJa: 1 })).toBe(
      'The demo catalog is already loaded. Added 1 product knowledge entry in English and 1 in Japanese.'
    );
  });

  it('names only the English entries when no Japanese version was added', () => {
    expect(describeSeed({ ...nothing, knowledge: 16 })).toBe('The demo catalog is already loaded. Added 16 product knowledge entries in English.');
  });

  it('says when nothing changed', () => {
    expect(describeSeed(nothing)).toBe('The demo catalog and its product knowledge are already loaded.');
  });
});

describe('describeReset', () => {
  const none = { appointments: 0, notifications: 0, questions: 0, inquiries: 0, knowledge: 0 };

  it('names everything the reset deleted, with the "and" before the last count', () => {
    expect(describeReset({ appointments: 3, notifications: 2, questions: 1, inquiries: 2, knowledge: 1 })).toBe(
      'Deleted 3 appointments, 2 notifications, 1 question, 2 inquiries and 1 product knowledge entry.'
    );
  });

  it.each([
    ['appointment', { ...none, appointments: 1 }, 'Deleted 1 appointment, 0 notifications, 0 questions, 0 inquiries and 0 product knowledge entries.'],
    ['notification', { ...none, notifications: 1 }, 'Deleted 0 appointments, 1 notification, 0 questions, 0 inquiries and 0 product knowledge entries.'],
    ['question', { ...none, questions: 1 }, 'Deleted 0 appointments, 0 notifications, 1 question, 0 inquiries and 0 product knowledge entries.'],
    ['inquiry', { ...none, inquiries: 1 }, 'Deleted 0 appointments, 0 notifications, 0 questions, 1 inquiry and 0 product knowledge entries.'],
    ['product knowledge entry', { ...none, knowledge: 1 }, 'Deleted 0 appointments, 0 notifications, 0 questions, 0 inquiries and 1 product knowledge entry.'],
  ])('says "1 %s" for one, and the plural for every other count', (_label, result, notice) => {
    expect(describeReset(result)).toBe(notice);
  });

  it('puts every count in the plural for 0 and for 2', () => {
    expect(describeReset(none)).toBe('Deleted 0 appointments, 0 notifications, 0 questions, 0 inquiries and 0 product knowledge entries.');
    expect(describeReset({ appointments: 2, notifications: 2, questions: 2, inquiries: 2, knowledge: 2 })).toBe(
      'Deleted 2 appointments, 2 notifications, 2 questions, 2 inquiries and 2 product knowledge entries.'
    );
  });

  it('names inquiries, which the reset deletes with the questions', () => {
    expect(describeReset({ ...none, inquiries: 14 })).toContain('14 inquiries');
  });
});

describe('describeActivity', () => {
  it('names what Load demo activity added, and who it came from', () => {
    expect(describeActivity({ created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 })).toBe(
      'Loaded 5 requests (2 confirmed), 5 questions and 10 inquiries from 5 made-up customers.'
    );
  });

  it('says when the demo activity was there already, and how to load it again', () => {
    expect(describeActivity({ created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 })).toBe(
      'The demo activity is already loaded. Reset demo activity first to load it again.'
    );
  });
});

describe('the plain messages', () => {
  it('say what is happening, in the words the brief gives', () => {
    expect(ACTIVITY_LOADING).toBe('Loading demo activity: the lists fill in over the next few seconds.');
    expect(TOO_SLOW).toBe('Strapi took too long to answer. Wait a few seconds: the lists refresh by themselves.');
  });
});

describe('demoNotice: what a demo button shows for an answer', () => {
  const ADDED = { created: true, customers: 5, appointments: 5, confirmed: 2, questions: 5, inquiries: 10 };
  const ALREADY = { created: false, customers: 0, appointments: 0, confirmed: 0, questions: 0, inquiries: 0 };

  it('says Load demo activity is loading when it answers 202, started', () => {
    expect(demoNotice('activity', { started: true, appointments: 5, questions: 5, inquiries: 10 })).toEqual({ type: 'info', message: ACTIVITY_LOADING });
  });

  it('says what Load demo activity added, or that it was there already, for a 200', () => {
    expect(demoNotice('activity', ADDED)).toEqual({ type: 'success', message: describeActivity(ADDED) });
    expect(demoNotice('activity', ALREADY)).toEqual({ type: 'success', message: describeActivity(ALREADY) });
  });

  it('says what Load demo catalog is adding in the background when it answers 202, started', () => {
    expect(demoNotice('seed', { started: true, ...nothing, knowledgeJa: 16 })).toEqual({
      type: 'info',
      message: 'Loading demo catalog in the background: 16 product knowledge entries in Japanese. It takes up to a minute.',
    });
    expect(demoNotice('seed', { started: true, ...firstLoad, created: undefined, knowledge: 16, knowledgeJa: 16 })).toEqual({
      type: 'info',
      message:
        'Loading demo catalog in the background: 12 products, 3 collections, 3 boutiques, 36 stock levels, 16 product knowledge entries in English and 16 in Japanese. It takes up to a minute.',
    });
  });

  it('says what Load demo catalog added, or that it was there already, for a 200', () => {
    expect(demoNotice('seed', nothing)).toEqual({ type: 'success', message: describeSeed(nothing) });
  });

  it('says what Reset deleted', () => {
    const result = { appointments: 3, notifications: 2, questions: 1, inquiries: 2, knowledge: 1 };
    expect(demoNotice('reset', result)).toEqual({ type: 'success', message: describeReset(result) });
  });

  // The admin's fetch client answers {} for a 200 whose body isn't JSON, such as a proxy's HTML page.
  it.each([
    ['an empty object', {}],
    ['nothing', undefined],
    ['null', null],
    ['a string', '<!DOCTYPE html>'],
    ['counts that are not numbers', { created: true, customers: '5' }],
  ])('shows the plain message, never a raw error, for an answer that is %s', (_label, answer) => {
    for (const action of ['seed', 'activity', 'reset'] as const) {
      expect(demoNotice(action, answer)).toEqual({ type: 'warning', message: TOO_SLOW });
    }
  });
});

describe('isStarted', () => {
  it('is true only for a 202 that says the work goes on in the background', () => {
    expect(isStarted({ started: true, appointments: 5, questions: 5, inquiries: 10 })).toBe(true);
    expect(isStarted({ created: true })).toBe(false);
    expect(isStarted({ started: 'yes' })).toBe(false);
    expect(isStarted({})).toBe(false);
    expect(isStarted(null)).toBe(false);
    expect(isStarted(undefined)).toBe(false);
  });
});

describe('demoErrorNotice: what a demo button shows when the press failed', () => {
  it("shows the plain message for an answer that isn't JSON, as when Strapi Cloud's proxy gives up and answers an HTML page", () => {
    let parseError: unknown;
    try {
      JSON.parse('<!DOCTYPE html><html></html>');
    } catch (error) {
      parseError = error;
    }
    expect(demoErrorNotice(parseError)).toEqual({ type: 'warning', message: TOO_SLOW });
  });

  it('knows the parse error by its name, which holds across realms, and by its words', () => {
    expect(demoErrorNotice({ name: 'SyntaxError', message: 'Unexpected end of JSON input' })).toEqual({ type: 'warning', message: TOO_SLOW });
    expect(demoErrorNotice(new Error(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`))).toEqual({ type: 'warning', message: TOO_SLOW });
  });

  it("shows the server's words as an info notice when a load is still running from the last press", () => {
    const busy = Object.assign(new Error('Demo activity is still loading from the last press: the lists fill in over the next few seconds.'), {
      name: 'FetchError',
      status: 409,
      response: { data: { error: { status: 409, details: { code: 'already_loading' } } } },
    });
    expect(demoErrorNotice(busy)).toEqual({ type: 'info', message: busy.message });
  });

  it("shows any other failure in the server's words, as before", () => {
    const failed = Object.assign(new Error("Load demo catalog first: there's no published boutique \"ginza\"."), {
      name: 'FetchError',
      response: { data: { error: { status: 404, details: { code: 'not_found' } } } },
    });
    expect(demoErrorNotice(failed)).toEqual({ type: 'danger', message: `That didn't work: ${failed.message}` });
    expect(demoErrorNotice('a string')).toEqual({ type: 'danger', message: "That didn't work: a string" });
  });
});
