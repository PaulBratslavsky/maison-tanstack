import { readFileSync } from 'node:fs';

import { expect, test, type Page, type Request } from '@playwright/test';

import { nextWeekday } from './support';

/**
 * The concierge screen, in the browser, with no model. Each test answers `POST /api/concierge` itself (`page.route`) with
 * a canned stream in TanStack AI's wire format: the route's own output, recorded from handleConcierge with a scripted
 * model (app/src/lib/concierge/recordings.test.ts keeps them current). Strapi is the real one: the picker's names, its
 * boutiques and its booking are live, with the demo customer's own session. The live checks with a model are run by hand.
 */

// A customer of their own: the default one has the other tests' open requests, and a booking here adds one.
const CONCIERGE_CUSTOMER = `U${'e'.repeat(32)}`;

/** The date the recordings use for "next Saturday", which a test puts the real next Saturday in place of. */
const RECORDED_DATE = '2026-10-10';

type Wire = { threadId: string; runId: string; forwardedProps: Record<string, unknown>; messages: Array<{ id: string; role: string; content?: string }> };
type Seen = { headers: Record<string, string>; body: Wire };

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** The recording with this request's own ids in it, and the real next Saturday in the picker. */
const replay = (name: string, body: Wire, date: string): string => {
  const customersMessage = body.messages.findLast((message) => message.role === 'user')?.id ?? 'u1';
  return fixture(name)
    .replaceAll('run-1', body.runId)
    .replaceAll('thread-1', body.threadId)
    .replaceAll('"u1"', JSON.stringify(customersMessage))
    .replaceAll(RECORDED_DATE, date);
};

/**
 * Answers the concierge route from the recordings, and keeps what the page sent. The first request of a conversation (the
 * customer spoke last) gets the demo's first turn, or `words` when the test only needs a reply. A request that carries
 * the picker's answer (a tool message last) gets the reply for it: after a visit was requested, or after Not now.
 */
const cannedConcierge = async (page: Page, { words = false }: { words?: boolean } = {}) => {
  const seen: Seen[] = [];
  const date = nextWeekday(6);
  await page.route('**/api/concierge', async (route) => {
    const request: Request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const body = request.postDataJSON() as Wire;
    seen.push({ headers: request.headers(), body });
    const last = body.messages.at(-1);
    const file =
      last?.role === 'tool'
        ? (last.content ?? '').includes('"requested"')
          ? 'concierge-after-request.sse'
          : 'concierge-after-closed.sse'
        : words
          ? 'concierge-after-closed.sse'
          : 'concierge-first-turn.sse';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: replay(file, body, date) });
  });
  return { seen, date };
};

type ToolCall = { name: string; arguments: Record<string, unknown> };

/** Every MCP tool the page calls on Strapi's /mcp from now on: its name, and the arguments it was sent. */
const toolCalls = (page: Page) => {
  const calls: ToolCall[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/mcp') return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return;
    }
    for (const message of Array.isArray(body) ? body : [body]) {
      const { method, params } = (message ?? {}) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (method === 'tools/call' && typeof params?.name === 'string') calls.push({ name: params.name, arguments: params.arguments ?? {} });
    }
  });
  return calls;
};

const FIRST_SUGGESTION = /gift under ¥400,000|40万円以内/;
const composer = (page: Page) => page.getByPlaceholder(/Write a message|メッセージを入力/);
const sendButton = (page: Page) => page.getByRole('button', { name: /^(Send|送信)$/ });
const picker = (page: Page) => page.getByTestId('visit-picker');
const toolLines = (page: Page) => page.getByTestId('tool-chip');

/** The demo's first suggestion, up to the picker: the form is on the screen. */
const askForVisit = async (page: Page) => {
  await page.getByRole('button', { name: FIRST_SUGGESTION }).click();
  await expect(picker(page)).toBeVisible();
  // The form's own first answer: the boutiques for the day.
  await expect(picker(page).getByLabel(/^(Time|時間)$/)).toBeVisible();
};

test('the screen starts with the intro, the suggestions and the composer', async ({ page }) => {
  await page.goto('/concierge');
  await expect(page.getByRole('heading', { level: 1, name: /Concierge|コンシェルジュ/ })).toBeVisible();
  await expect(page.getByText(/I can help you choose a gift|ギフト選びやご来店/)).toBeVisible();
  await expect(page.getByRole('button', { name: FIRST_SUGGESTION })).toBeVisible();
  await expect(page.getByRole('button', { name: /Can I book a visit\?|来店を予約できますか/ })).toBeVisible();
  await expect(composer(page)).toHaveAttribute('maxlength', '1000');
  await expect(sendButton(page)).toBeDisabled();
});

test('the title bar names the 8 tools, and its panel holds the Agent view switch', async ({ page }) => {
  await page.goto('/concierge');
  await page.getByRole('button', { name: /8 MCP tools|8つのMCPツール/ }).click();
  await expect(page.getByTestId('tool-badge')).toHaveCount(8);
  await expect(page.getByRole('switch', { name: /Agent view|エージェントビュー/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-badge').first()).toBeHidden();
});

test("the Home button leads to the concierge, and a piece's Ask about this piece opens it with the piece in context", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Ask the concierge|コンシェルジュに相談する/ }).click();
  await expect(page).toHaveURL(/\/concierge$/);
  await expect(page.getByText(/I can help you choose a gift|ギフト選びやご来店/)).toBeVisible();

  await page.goto('/products/weekender-50');
  await page.getByTestId('ask-about-piece').click();
  await expect(page).toHaveURL(/\/concierge\?product=weekender-50$/);
  await expect(page.getByText(/Ask me anything about this piece|この商品について、お手入れ/)).toBeVisible();
});

test('?product=weekender-50 shows the piece intro and its suggestions, and sends the piece with each message', async ({ page }) => {
  const { seen } = await cannedConcierge(page, { words: true });
  await page.goto('/concierge?product=weekender-50');
  await expect(page.getByText(/Ask me anything about this piece|この商品について、お手入れ/)).toBeVisible();
  await expect(page.getByRole('button', { name: FIRST_SUGGESTION })).toHaveCount(0);
  await page.getByRole('button', { name: /care for it|お手入れ方法/ }).click();
  await expect(page.getByText('Of course. I am here if you change your mind.')).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0].body.forwardedProps).toMatchObject({ product: 'weekender-50', locale: 'en' });
  // The customer's session goes as a Bearer token. Checked without printing it.
  expect(/^Bearer mcp_at_\S+$/.test(seen[0].headers.authorization ?? ''), 'the request carries the customer session token').toBe(true);
});

test('a ?product= that is not a slug is dropped: the page is the plain concierge', async ({ page }) => {
  await page.goto('/concierge?product=Weekender%2050');
  await expect(page.getByText(/I can help you choose a gift|ギフト選びやご来店/)).toBeVisible();
});

test("the demo's first suggestion ends in a picker filled in for Ginza, next Saturday, 14:00", async ({ page }) => {
  const { seen, date } = await cannedConcierge(page);
  await page.goto('/concierge');
  await askForVisit(page);
  expect(seen).toHaveLength(1);
  expect(seen[0].body.forwardedProps).toEqual({ locale: 'en' });

  // The customer's words, the concierge's, the tool lines and the pieces found.
  await expect(page.getByTestId('message-user')).toContainText(FIRST_SUGGESTION);
  await expect(page.getByText('Here are three pieces for a friend who travels.')).toBeVisible();
  await expect(toolLines(page)).toHaveText(['MCP · search_products ✓ 3 results', `Local · resolve_date ✓ Saturday ${date}`, 'Local · choose_visit']);
  await expect(page.getByRole('link', { name: /Weekender 50/ })).toHaveAttribute('href', '/products/weekender-50');

  // The form, filled in from the call, with the piece's name from Strapi.
  const form = picker(page);
  await expect(form.getByRole('heading', { name: 'Book a visit' })).toBeVisible();
  await expect(form.getByText('Weekender 50')).toBeVisible();
  await expect(form.getByLabel(/^Boutique$/).getByRole('radio', { name: /Ginza/ })).toBeChecked();
  const day = Number(date.slice(8));
  await expect(form.getByLabel(/^Date$/).getByRole('radio', { name: new RegExp(`^Sat ${day}$`) })).toHaveAttribute('aria-checked', 'true');
  await expect(form.getByLabel(/^Time$/).getByRole('radio', { name: '14:00' })).toHaveAttribute('aria-checked', 'true');

  // The composer waits for the customer's answer.
  await composer(page).fill('One more thing');
  await expect(sendButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: /Can I book a visit\?/ })).toBeDisabled();
});

test('Send request books the visit with the customer, answers the concierge once, and the booking card leads to the visit', async ({ page }) => {
  const { seen, date } = await cannedConcierge(page);
  await page.goto(`/?demoUser=${CONCIERGE_CUSTOMER}`);
  await page.getByRole('link', { name: /Ask the concierge|コンシェルジュに相談する/ }).click();
  const calls = toolCalls(page);
  await askForVisit(page);

  await picker(page).getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Your visit is requested. The boutique will confirm it on LINE.')).toBeVisible();

  // The browser booked it, with the same arguments the product sheet sends.
  const booked = calls.filter((call) => call.name === 'request_appointment');
  expect(booked).toHaveLength(1);
  expect(booked[0].arguments).toEqual({ boutique: 'ginza', productSlugs: ['weekender-50'], requestedFor: `${date}T14:00:00+09:00`, locale: 'en' });

  // One answer, one more request, which carries the answer with the visit in it. None after the reply.
  await page.waitForTimeout(500);
  expect(seen).toHaveLength(2);
  const answer = seen[1].body.messages.at(-1);
  expect(answer?.role).toBe('tool');
  expect(answer?.content).toContain('"status":"requested"');
  expect(answer?.content).toMatch(/APT-\d{4}/);

  // The form is the visit's card now, and the lines say what happened.
  await expect(picker(page)).toHaveCount(0);
  const card = page.getByRole('link', { name: /APT-\d{4}/ });
  await expect(card).toContainText(/Ginza/);
  await expect(card).toContainText('Awaiting the boutique');
  await expect(toolLines(page).filter({ hasText: 'Local · choose_visit ✓ requested' })).toHaveCount(1);
  await expect(toolLines(page).filter({ hasText: 'MCP · request_appointment ✓' })).toHaveCount(1);
  const href = (await card.getAttribute('href')) ?? '';
  expect(href).toMatch(/^\/visits\/APT-\d{4}$/);
  // The composer is free again.
  await expect(page.getByRole('button', { name: /Can I book a visit\?/ })).toBeEnabled();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Ginza/);
});

test('Not now closes the picker without a request, and the concierge answers once', async ({ page }) => {
  const { seen } = await cannedConcierge(page);
  const calls = toolCalls(page);
  await page.goto('/concierge');
  await askForVisit(page);

  await picker(page).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Of course. I am here if you change your mind.')).toBeVisible();
  await expect(page.getByText('Closed without a request.')).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await expect(toolLines(page).filter({ hasText: 'Local · choose_visit ✓ closed' })).toHaveCount(1);
  await expect(toolLines(page).filter({ hasText: 'request_appointment' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(seen).toHaveLength(2);
  expect(seen[1].body.messages.at(-1)?.content).toContain('"status":"closed"');
  expect(calls.filter((call) => call.name === 'request_appointment')).toHaveLength(0);
  await expect(page.getByRole('button', { name: /Can I book a visit\?/ })).toBeEnabled();
});

test.describe('a phone in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('hides the suggestions once the conversation has begun, to leave it room', async ({ page }) => {
    await cannedConcierge(page, { words: true });
    await page.goto('/concierge');
    const suggestion = page.getByRole('button', { name: /Can I book a visit\?/ });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(page.getByText('Of course. I am here if you change your mind.')).toBeVisible();
    await expect(suggestion).toBeHidden();
    await expect(composer(page)).toBeVisible();
  });
});
