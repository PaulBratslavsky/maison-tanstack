// @vitest-environment jsdom
import { lightTheme } from '@strapi/design-system';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MaisonPage from '../../admin/src/pages/MaisonPage';
import { PAGE_SUBTITLE } from '../../admin/src/tabs';
import { renderInTheme } from './render';

/*
 * The Maison page, with Strapi's page helpers and the page's lists replaced by stand-ins: what is held here is the page's own: its header, its
 * tabs, the tab in the address, and the Demo data block. The lists have tests of their own.
 */
const rbac = vi.hoisted(() => ({ use: vi.fn() }));
const loaded = vi.hoisted(() => ({
  requests: { summary: null as null | { counts: { waitingForStaff: number; confirmedUpcoming: number; confirmationsSent: number } }, loadError: null },
  questions: { count: null as null | number, loadError: null, reload: () => {} },
  inquiries: { summary: null as null | { needsAnswer: number; complaint: number; praise: number; notLabelled: number }, loadError: null, reload: () => {} },
}));

vi.mock('@strapi/strapi/admin', () => ({
  useRBAC: () => rbac.use(),
  Page: {
    Protect: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Main: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
    Title: () => null,
    Loading: () => <p>Loading</p>,
  },
}));
vi.mock('../../admin/src/components/RequestsBoard', () => ({ RequestsBoard: () => <section aria-label="Requests board">The board</section> }));
vi.mock('../../admin/src/components/RequestCounts', () => ({ RequestCounts: () => <section aria-label="Request counts">The counts</section> }));
vi.mock('../../admin/src/components/QuestionsList', () => ({ QuestionsList: () => <section aria-label="Questions list">The questions</section> }));
vi.mock('../../admin/src/components/InquiriesList', () => ({ InquiriesList: () => <section aria-label="Inquiries list">The inquiries</section> }));
vi.mock('../../admin/src/components/DemoData', () => ({ DemoData: () => <section aria-label="Demo data">The demo data</section> }));
vi.mock('../../admin/src/useRequestsSummary', () => ({ useRequestsSummary: () => loaded.requests }));
vi.mock('../../admin/src/useOpenQuestions', () => ({ useOpenQuestions: () => loaded.questions }));
vi.mock('../../admin/src/useInquiriesSummary', () => ({ useInquiriesSummary: () => loaded.inquiries }));

const EVERYTHING = { canReview: true, canConfirm: true, canManage: true, canRead: true, canAnswer: true, canView: true, canReply: true };
/** What useRBAC answers for an admin: only the flags they hold are true, as the page reads them. */
const asAdmin = (flags: Record<string, boolean>) => rbac.use.mockReturnValue({ isLoading: false, allowedActions: flags, permissions: [], error: undefined });

const Where = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{`${pathname}${search}`}</p>;
};
const showPage = (path = '/plugins/maison') =>
  renderInTheme(
    <MemoryRouter initialEntries={[path]}>
      <MaisonPage />
      <Where />
    </MemoryRouter>
  );

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

/** The CSS styled-components wrote for an element: every rule in the document that starts with one of its classes, with the rules of its media queries. */
const cssOf = (element: Element): string => {
  const all = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const classes = Array.from(element.classList);
  return all
    .split('}')
    .filter((rule) => classes.some((name) => rule.trimStart().startsWith(`.${name}`) || rule.includes(`{.${name}{`)))
    .map((rule) => `${rule}}`)
    .join('\n');
};

beforeEach(() => {
  loaded.requests = { summary: null, loadError: null };
  loaded.questions = { count: null, loadError: null, reload: () => {} };
  loaded.inquiries = { summary: null, loadError: null, reload: () => {} };
  asAdmin(EVERYTHING);
});

describe('the Maison page', () => {
  describe('its header', () => {
    it('has the title "Maison" as the page\'s h1, and the subtitle beside it in the same row', () => {
      showPage();
      const title = screen.getByRole('heading', { level: 1, name: 'Maison' });
      const subtitle = screen.getByText(PAGE_SUBTITLE);

      expect(title.tagName).toBe('H1');
      expect(subtitle.parentElement).toBe(title.parentElement);
      expect(title.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('has one h1 and nothing taller above the tabs: the old header, with its large title and its padding, is gone', () => {
      showPage();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(document.querySelector('[data-strapi-header]')).toBeNull();
    });

    it('writes the title as the beta text and the subtitle as the omega text in the secondary grey', () => {
      showPage();
      const title = screen.getByRole('heading', { level: 1, name: 'Maison' });
      const subtitle = screen.getByText(PAGE_SUBTITLE);
      expect(cssOf(title)).toContain('font-size:1.8rem;');
      expect(cssOf(subtitle)).toContain('font-size:1.4rem;');
      expect(cssOf(subtitle)).toContain(`color:${lightTheme.colors.neutral600};`);
    });

    it('lets the subtitle wrap under the title when the screen is narrow', () => {
      showPage();
      const row = screen.getByRole('heading', { level: 1, name: 'Maison' }).parentElement as HTMLElement;
      expect(cssOf(row)).toMatch(/[{;]flex-wrap:wrap;/);
    });

    it('is about 56px high, with 24px above it', () => {
      showPage();
      const header = document.querySelector('[data-maison-header]') as HTMLElement;
      // The design system writes spacing as logical properties: the start of the block is the top.
      expect(cssOf(header)).toMatch(/[{;]padding-block-start:24px;/);
      expect(cssOf(header.firstElementChild as Element)).toMatch(/[{;]min-height:5\.6rem;/);
    });

    it('puts the tab row 8px under the header, and the content of a tab 16px under the tabs', () => {
      showPage();
      const header = document.querySelector('[data-maison-header]') as HTMLElement;
      expect(cssOf(header.parentElement as Element)).toMatch(/[{;]gap:8px;/);
      const panel = screen.getByRole('tabpanel');
      expect(cssOf(panel.firstElementChild as Element)).toMatch(/[{;]padding-block-start:16px;/);
    });

    it('keeps the side padding the page had: 16px, then 24px from 768px wide and 56px from 1080px wide', () => {
      showPage();
      const header = document.querySelector('[data-maison-header]') as HTMLElement;
      // The one box that holds the header and everything under it, so the header and the tabs have the same sides.
      const sides = cssOf(header.parentElement?.parentElement as Element);
      expect(sides).toMatch(/[{;]padding-inline-start:16px;padding-inline-end:16px;/);
      expect(sides).toMatch(/@media\(min-width: 768px\)\{\.[\w-]+\{padding-inline-start:24px;padding-inline-end:24px;/);
      expect(sides).toMatch(/@media\(min-width: 1080px\)\{\.[\w-]+\{padding-inline-start:56px;padding-inline-end:56px;/);
    });
  });

  describe('its tabs', () => {
    it('are Requests, Questions and Inquiries, in that order, for an admin who may see all three', () => {
      showPage();
      expect(tabNames()).toEqual(['Requests', 'Questions', 'Inquiries']);
    });

    it('are the same three for an admin who may also use the assistant: there is no Ask tab, and the page has no assistant of its own', () => {
      asAdmin({ ...EVERYTHING, canUse: true });
      showPage();
      expect(tabNames()).toEqual(['Requests', 'Questions', 'Inquiries']);
      expect(screen.queryByRole('tab', { name: /ask/i })).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('show only what the admin may see', () => {
      asAdmin({ canRead: true, canView: true });
      showPage();
      expect(tabNames()).toEqual(['Questions', 'Inquiries']);
    });

    it('open on the first tab, which shows its list', () => {
      loaded.requests = { summary: { counts: { waitingForStaff: 3, confirmedUpcoming: 2, confirmationsSent: 1 } }, loadError: null };
      showPage();
      expect(selectedTab()).toBe('Requests 3');
      expect(screen.getByLabelText('Requests board')).toBeTruthy();
      expect(screen.getByLabelText('Request counts')).toBeTruthy();
    });

    it('open on the tab the address names, when the admin may see it', () => {
      showPage('/plugins/maison?tab=inquiries');
      expect(selectedTab()).toBe('Inquiries');
      expect(screen.getByLabelText('Inquiries list')).toBeTruthy();
    });

    // Ask was a tab until the assistant became a drawer, so an address or a bookmark may still say so.
    it('open on the first tab for `?tab=ask`: an old link to the Ask tab still opens the page', () => {
      showPage('/plugins/maison?tab=ask');
      expect(selectedTab()).toBe('Requests');
      expect(screen.getByLabelText('Requests board')).toBeTruthy();
    });

    it('open on the first tab they may see when the address names one they may not', () => {
      asAdmin({ canRead: true });
      showPage('/plugins/maison?tab=inquiries');
      expect(selectedTab()).toBe('Questions');
    });

    it('put the tab in the address when staff pick one, which replaces the address instead of adding to the history', async () => {
      showPage();
      await userEvent.click(screen.getByRole('tab', { name: 'Questions' }));
      expect(screen.getByTestId('location').textContent).toBe('/plugins/maison?tab=questions');
      expect(selectedTab()).toBe('Questions');
      expect(screen.getByLabelText('Questions list')).toBeTruthy();
    });

    it('say how many are waiting after the name of each, and nothing for none', () => {
      loaded.requests = { summary: { counts: { waitingForStaff: 3, confirmedUpcoming: 2, confirmationsSent: 1 } }, loadError: null };
      loaded.questions = { count: 2, loadError: null, reload: () => {} };
      loaded.inquiries = { summary: { needsAnswer: 0, complaint: 5, praise: 6, notLabelled: 7 }, loadError: null, reload: () => {} };
      showPage();
      expect(tabNames()).toEqual(['Requests 3', 'Questions 2', 'Inquiries']);
    });
  });

  describe('the Demo data block', () => {
    it('is under the tabs, on every tab, for an admin who may manage it: no tab fills the page any more', async () => {
      showPage();
      for (const name of ['Requests', 'Questions', 'Inquiries']) {
        await userEvent.click(screen.getByRole('tab', { name }));
        expect(screen.getByLabelText('Demo data'), name).toBeTruthy();
        const tabs = screen.getByRole('tablist');
        expect(tabs.compareDocumentPosition(screen.getByLabelText('Demo data')) & Node.DOCUMENT_POSITION_FOLLOWING, name).toBeTruthy();
      }
    });

    it('is the whole page, with no tab, for an admin who may only manage the demo data', () => {
      asAdmin({ canManage: true });
      showPage();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.getByLabelText('Demo data')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Maison' })).toBeTruthy();
    });

    it('is never shown to an admin who may not manage it, on any tab', async () => {
      asAdmin({ canReview: true, canRead: true, canView: true });
      showPage();
      for (const name of ['Requests', 'Questions', 'Inquiries']) {
        await userEvent.click(screen.getByRole('tab', { name }));
        expect(screen.queryByLabelText('Demo data'), name).toBeNull();
      }
    });
  });

  it('shows only the loading page while the permissions are checked', () => {
    rbac.use.mockReturnValue({ isLoading: true, allowedActions: {}, permissions: [], error: undefined });
    showPage();
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(within(document.body).queryByRole('tab')).toBeNull();
  });
});
