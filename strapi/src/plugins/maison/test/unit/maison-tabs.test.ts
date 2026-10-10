import { describe, expect, it } from 'vitest';
import { PAGE_SUBTITLE, TABS, TAB_LABELS, selectTab, tabCounts, tabLabel, visibleTabs } from '../../admin/src/tabs';
import { COUNTS } from '../../admin/src/inquiries';
import { isSummary } from '../../admin/src/inquiries';
import { world } from './fake-inquiries';

describe('the tabs of the Maison page', () => {
  // The assistant was a fourth tab, Ask, until it became a drawer on every admin page.
  it('are Requests, Questions and Inquiries: the assistant is not a tab', () => {
    expect(TAB_LABELS).toEqual({ requests: 'Requests', questions: 'Questions', inquiries: 'Inquiries' });
  });

  it('are the three lists, in the order of the page', () => {
    expect(TABS).toEqual(['requests', 'questions', 'inquiries']);
  });

  it('are the three lists, in that order, for an admin who may see all of them', () => {
    expect(visibleTabs({ canReview: true, canRead: true, canView: true })).toEqual(['requests', 'questions', 'inquiries']);
  });

  it('are the same for an admin who may also use the assistant: that permission adds no tab', () => {
    expect(visibleTabs({ canReview: true, canRead: true, canView: true, canUse: true } as never)).toEqual(['requests', 'questions', 'inquiries']);
    expect(visibleTabs({ canReview: false, canRead: false, canView: false, canUse: true } as never)).toEqual([]);
  });

  it.each([
    ['review requests', { canReview: true, canRead: false, canView: false }, ['requests']],
    ['read questions', { canReview: false, canRead: true, canView: false }, ['questions']],
    ['view inquiries', { canReview: false, canRead: false, canView: true }, ['inquiries']],
    ['review requests and view inquiries', { canReview: true, canRead: false, canView: true }, ['requests', 'inquiries']],
    ['read questions and view inquiries', { canReview: false, canRead: true, canView: true }, ['questions', 'inquiries']],
    ['review requests and read questions', { canReview: true, canRead: true, canView: false }, ['requests', 'questions']],
  ])('are only what an admin who can %s may see', (_label, flags, tabs) => {
    expect(visibleTabs(flags)).toEqual(tabs);
  });

  it('are none for an admin who can only manage the demo data: the page shows just that', () => {
    expect(visibleTabs({ canReview: false, canRead: false, canView: false })).toEqual([]);
  });

  it('treat a flag useRBAC has not answered as no permission', () => {
    expect(visibleTabs({} as never)).toEqual([]);
    expect(visibleTabs({ canView: true } as never)).toEqual(['inquiries']);
    expect(visibleTabs({ canView: true, canReview: undefined } as never)).toEqual(['inquiries']);
  });
});

describe('the page subtitle', () => {
  // The subtitle sat on the page after the Inquiries tab was added, and still named only requests and questions.
  it('names what each tab shows: the requests, the questions and the inquiries', () => {
    const subtitle = PAGE_SUBTITLE.toLowerCase();
    for (const tab of TABS) expect(subtitle, TAB_LABELS[tab]).toContain(TAB_LABELS[tab].toLowerCase());
  });
});

describe('tabLabel', () => {
  it("writes how many are waiting after the tab's name", () => {
    expect(tabLabel('requests', 3)).toBe('Requests 3');
    expect(tabLabel('questions', 2)).toBe('Questions 2');
    expect(tabLabel('inquiries', 2)).toBe('Inquiries 2');
  });

  it('writes the name alone when nothing is waiting, and before the number has loaded', () => {
    for (const tab of ['requests', 'questions', 'inquiries'] as const) {
      expect(tabLabel(tab, 0), tab).toBe(TAB_LABELS[tab]);
      expect(tabLabel(tab, null), tab).toBe(TAB_LABELS[tab]);
      expect(tabLabel(tab, undefined), tab).toBe(TAB_LABELS[tab]);
    }
  });

  it('writes the name alone for a number that is not a count', () => {
    for (const waiting of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5, '2' as never]) {
      expect(tabLabel('questions', waiting), String(waiting)).toBe('Questions');
    }
  });

  it('writes thousands with a comma, as the quota line does', () => {
    expect(tabLabel('inquiries', 1234)).toBe('Inquiries 1,234');
  });
});

describe('the number on each tab', () => {
  const REQUESTS = { counts: { waitingForStaff: 3, confirmedUpcoming: 2, confirmationsSent: 1 } };

  it('is the requests waiting for staff, the questions the Open filter lists, and the inquiries that need an answer', () => {
    expect(tabCounts({ requests: REQUESTS, questions: 2, inquiries: { needsAnswer: 4, complaint: 5, praise: 6, notLabelled: 7 } })).toEqual({
      requests: 3,
      questions: 2,
      inquiries: 4,
    });
  });

  it('is none for a tab whose number has not loaded', () => {
    expect(tabCounts({ requests: null, questions: null, inquiries: null })).toEqual({ requests: null, questions: null, inquiries: null });
  });

  it("reads the key the server's inquiries summary has for Needs an answer", async () => {
    const summary = await world({ rows: [] }).service.summary();
    expect(isSummary(summary)).toBe(true);
    expect(COUNTS[0].key).toBe('needsAnswer');
    expect(tabCounts({ requests: null, questions: null, inquiries: summary }).inquiries).toBe(summary.needsAnswer);
  });
});

describe('selectTab', () => {
  const ALL = ['requests', 'questions', 'inquiries'] as const;

  it.each(ALL)('opens the %s tab when the address asks for it and the admin may see it', (tab) => {
    expect(selectTab(ALL, tab)).toBe(tab);
  });

  it('opens the first tab when the address asks for none', () => {
    expect(selectTab(ALL, null)).toBe('requests');
    expect(selectTab(ALL, undefined)).toBe('requests');
    expect(selectTab(ALL, '')).toBe('requests');
    expect(selectTab(['questions', 'inquiries'], null)).toBe('questions');
  });

  it("opens the first tab the admin may see when the one asked for isn't theirs", () => {
    expect(selectTab(['questions'], 'inquiries')).toBe('questions');
    expect(selectTab(['inquiries'], 'requests')).toBe('inquiries');
    expect(selectTab(['requests', 'questions'], 'inquiries')).toBe('requests');
  });

  it("opens the first tab for a name that isn't a tab, including the names every object has", () => {
    for (const name of ['nonsense', 'Inquiries', 'INQUIRIES', ' inquiries', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(selectTab(ALL, name), name).toBe('requests');
    }
  });

  it('opens nothing for an admin with no tabs', () => {
    expect(selectTab([], 'inquiries')).toBeUndefined();
    expect(selectTab([], null)).toBeUndefined();
  });

  // Ask was a tab until the assistant became a drawer, so an address or a bookmark may still say `?tab=ask`. It opens the first tab, as any name that is not a tab does.
  it('opens the first tab for `ask`, which was a tab before the assistant became a drawer: an old link still opens the page', () => {
    expect(selectTab(ALL, 'ask')).toBe('requests');
    expect(selectTab(['questions', 'inquiries'], 'ask')).toBe('questions');
    expect(selectTab([], 'ask')).toBeUndefined();
  });

  it('reads a query string as the address gives it', () => {
    expect(selectTab(ALL, new URLSearchParams('tab=inquiries').get('tab'))).toBe('inquiries');
    expect(selectTab(ALL, new URLSearchParams('tab=questions&x=1').get('tab'))).toBe('questions');
    expect(selectTab(ALL, new URLSearchParams('').get('tab'))).toBe('requests');
  });
});
