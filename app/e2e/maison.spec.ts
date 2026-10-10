import { expect, test, type Page } from '@playwright/test';

import { strapiOrigin } from './env';
import { nextWeekday } from './support';

const SECOND_CUSTOMER = `U${'b'.repeat(32)}`;
const JAPANESE_CUSTOMER = `U${'c'.repeat(32)}`;
const LINE_CHAT_CUSTOMER = `U${'d'.repeat(32)}`;

const WEEKENDER = /Weekender|ウィークエンダー/;

/** Tomorrow's date on Tokyo's calendar, as the app counts it (YYYY-MM-DD: en-CA writes dates that way; Tokyo has no DST). */
const tokyoTomorrow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));

/** How long from now until a minute past Tokyo's next midnight, in ms. Tokyo is UTC+9 all year. */
const pastTokyoMidnight = () => {
  const day = 24 * 60 * 60 * 1000;
  return day - ((Date.now() + 9 * 60 * 60 * 1000) % day) + 60_000;
};

/** Opens a piece of the Voyage collection from Home. */
const openProduct = async (page: Page, name: RegExp) => {
  await page.goto('/');
  await page.getByTestId('collection-card').filter({ hasText: /Voyage|ヴォヤージュ/ }).click();
  await page.getByTestId('product-card').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
};

// The booking sheet's controls, by their accessible names: a radio group per boutique, day and time. The names are
// anchored: the Japanese note's label, ブティックへのメッセージ, also holds ブティック.
const boutiqueRadio = (page: Page, name: RegExp) => page.getByLabel(/^(Boutique|ブティック)$/).getByRole('radio', { name });
const timeChip = (page: Page, time: string) => page.getByLabel(/^(Time|時間)$/).getByRole('radio', { name: time });
/** A day's chip (YYYY-MM-DD): "Sat 10" in English, "10日(土)" in Japanese. The sheet offers the two weeks from tomorrow. */
const dayChip = (page: Page, date: string) => {
  const day = Number(date.slice(8));
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday];
  return page.getByLabel(/^(Date|日付)$/).getByRole('radio', { name: new RegExp(`^(${en} ${day}|${day}日\\(${'日月火水木金土'[weekday]}\\))$`) });
};

/** Books the Weekender at Ginza on the next Saturday at 14:00, and returns the new visit's reference (the URL has it). */
const bookWeekender = async (page: Page) => {
  await openProduct(page, WEEKENDER);
  await page.getByRole('button', { name: /Book a visit|来店を予約/ }).click();
  await boutiqueRadio(page, /Ginza|銀座/).check();
  await dayChip(page, nextWeekday(6)).click();
  await timeChip(page, '14:00').click();
  await page.getByRole('button', { name: /Send request|リクエストを送る/ }).click();
  await expect(page).toHaveURL(/\/visits\?ref=APT-\d{4}/);
  const reference = new URL(page.url()).searchParams.get('ref');
  expect(reference).toMatch(/^APT-\d{4}$/);
  return reference as string;
};

/** Opens the booking sheet on a piece, the Weekender by default, and waits for the answer to its first availability check: the Time chips. */
const openSheet = async (page: Page, name: RegExp = WEEKENDER) => {
  await openProduct(page, name);
  await page.getByRole('button', { name: /Book a visit|来店を予約/ }).click();
  await expect(page.getByLabel(/Time|時間/)).toBeVisible();
};

type ToolCall = { name: string; arguments: Record<string, unknown> };

/** Every MCP tool the page calls on Strapi's /mcp, in order, from now on: its name, and the arguments it was sent. */
const toolCalls = (page: Page) => {
  const calls: ToolCall[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/mcp') return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return; // not JSON, so not a tool call
    }
    for (const message of Array.isArray(body) ? body : [body]) {
      const { method, params } = (message ?? {}) as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (method === 'tools/call' && typeof params?.name === 'string') calls.push({ name: params.name, arguments: params.arguments ?? {} });
    }
  });
  return calls;
};
const namesOf = (calls: ToolCall[]) => calls.map((call) => call.name);
/** The arguments of each call to the tool `name`, in order. */
const argumentsOf = (calls: ToolCall[], name: string) => calls.filter((call) => call.name === name).map((call) => call.arguments);

/**
 * Submits the booking form without its Send button, which is disabled: the way Enter in a field or a script could. The
 * browser's own validation is switched off too (a date before the input's `min` would stop the submit), so it's the sheet's
 * own guard that gets tested. Resolves to whether the form's submit event fired: without a submit, "nothing was sent" proves
 * nothing.
 */
const forceSubmit = (page: Page) =>
  page
    .getByRole('dialog')
    .locator('form')
    .evaluate(
      (form: HTMLFormElement) =>
        new Promise<boolean>((resolve) => {
          form.noValidate = true;
          form.addEventListener('submit', () => resolve(true), { once: true });
          form.requestSubmit(); // fires the submit event synchronously, or not at all
          resolve(false);
        })
    );

/** Lets whatever the page was about to send go out first, so that checking it sent nothing is fair. */
const settle = (page: Page) => page.waitForTimeout(500);

/** No request_appointment leaves the sheet: Send is disabled, and a submit that gets past the button is refused too. */
const expectNothingSent = async (page: Page, calls: ToolCall[]) => {
  await expect(page.getByRole('button', { name: /Send request|リクエストを送る/ })).toBeDisabled();
  expect(await forceSubmit(page), 'the form was submitted').toBe(true);
  await settle(page);
  expect(namesOf(calls)).not.toContain('request_appointment');
};

test('a customer browses, books a visit and finds it in My visits', async ({ page }) => {
  const calls = toolCalls(page);
  const reference = await bookWeekender(page);
  // The sheet sends the customer's language (English here, the app's default), so the answer names the boutique and
  // products in it.
  expect(argumentsOf(calls, 'request_appointment').map((args) => args.locale)).toEqual(['en']);
  // The visit just booked, found by its reference: the list isn't assumed to be in any order.
  const visit = page.getByTestId('visit').filter({ hasText: reference });
  await expect(visit).toContainText(/Ginza|銀座/);
  await expect(visit).toContainText(/Awaiting the boutique|ブティックの確認待ち/);
});

test("the booking sheet sends the customer's language: a request made in Japanese says ja", async ({ page }) => {
  // A customer of their own, so this visit isn't one of the default customer's three open requests. The switch's choice
  // is remembered by the browser, so the pages that follow start in Japanese.
  await page.goto(`/?demoUser=${JAPANESE_CUSTOMER}`);
  await page.getByRole('group', { name: /Language|言語/ }).getByRole('button', { name: 'JA' }).click();
  const calls = toolCalls(page);
  await bookWeekender(page);
  expect(argumentsOf(calls, 'request_appointment').map((args) => args.locale)).toEqual(['ja']);
});

test('Osaka is closed on Tuesdays, and the sheet says so before any request', async ({ page }) => {
  const calls = toolCalls(page);
  // A piece Osaka has: the sheet doesn't offer a boutique without the piece (the next test), and Osaka has no Weekender.
  await openSheet(page, /Cabin Case|キャビン・ケース/);
  await boutiqueRadio(page, /Osaka|大阪/).check();
  await dayChip(page, nextWeekday(2)).click();
  await expect(page.getByText(/Closed on this day|この日は休業日です/)).toBeVisible();
  await expectNothingSent(page, calls);
});

test("a boutique without the piece can't be chosen, and says so", async ({ page }) => {
  // Osaka has no Weekender in stock (the demo's seed): its radio is disabled, its name says why, and Ginza stays chosen.
  await openSheet(page);
  const osaka = boutiqueRadio(page, /Osaka|大阪/);
  await expect(osaka).toBeDisabled();
  await expect(osaka).toHaveAccessibleName(/not in stock|在庫なし/);
  await expect(boutiqueRadio(page, /Ginza|銀座/)).toBeChecked();
  await expect(page.getByRole('button', { name: /Send request|リクエストを送る/ })).toBeEnabled();
});

test('a day that has become today asks for a later one, and sends no request', async ({ page }) => {
  // The chips start tomorrow, so a day becomes too soon only when Tokyo's midnight passes with the sheet open on it. The
  // page's clock runs as usual until the test moves it past midnight.
  await page.clock.install();
  const calls = toolCalls(page);
  await openSheet(page);
  await page.getByLabel(/^(Date|日付)$/).getByRole('radio').first().click();
  // Tomorrow's availability is back: the sheet asked for it, then showed its times.
  await expect.poll(() => argumentsOf(calls, 'find_boutiques').at(-1)?.date).toBe(tokyoTomorrow());
  await expect(page.getByLabel(/Time|時間/)).toBeVisible();
  const before = [...calls];
  await page.clock.fastForward(pastTokyoMidnight());
  await expect(page.getByText(/^(Please choose a date from tomorrow on\.|明日以降の日付をお選びください。)$/)).toBeVisible();
  await expectNothingSent(page, calls);
  expect(calls, 'no tool is called for a date that is too soon').toEqual(before);
});

/** The Home page's published headline in Strapi, in one language, as the app's server reads it (lib/home-page.ts). */
const publishedHeadline = async (locale: 'en' | 'ja'): Promise<string> => {
  const response = await fetch(`${strapiOrigin()}/api/home-page?locale=${locale}`);
  expect(response.status, `GET /api/home-page?locale=${locale}`).toBe(200);
  return ((await response.json()) as { data: { headline: string } }).data.headline.trim();
};

test("Home shows the Home page's headline from Strapi, in English, then in Japanese after the switch", async ({ page }) => {
  // Read from Strapi, not written here: the headline is Paul's to edit in the Content Manager.
  const [en, ja] = await Promise.all([publishedHeadline('en'), publishedHeadline('ja')]);
  await page.goto('/');
  const language = page.getByRole('group', { name: /Language|言語/ });
  await language.getByRole('button', { name: 'EN' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en);
  await language.getByRole('button', { name: 'JA' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ja);
});

test('the agent view shows the MCP tools behind each screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('switch', { name: /Agent view|エージェントビュー/ }).click();
  await expect(page.getByTestId('agent-call').first()).toContainText('browse_collections');
  await page.getByTestId('collection-card').first().click();
  await expect(page.getByTestId('agent-call').filter({ hasText: 'search_products' })).toBeVisible();
});

test('an unknown product says so, and leads back to the start', async ({ page }) => {
  await page.goto('/products/no-such-piece');
  await expect(page.getByText(/We couldn't find that|お探しのものは見つかりませんでした/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to the start|トップへ戻る/ })).toBeVisible();
});

test("a second customer doesn't see the first customer's visits", async ({ context }) => {
  // One browser, two customers. The first tab is the default demo customer, who books a visit here; the second tab
  // signs in as another customer with ?demoUser=.
  const first = await context.newPage();
  const reference = await bookWeekender(first);
  const firstVisit = first.getByTestId('visit').filter({ hasText: reference });
  await expect(firstVisit).toBeVisible();

  const second = await context.newPage();
  await second.goto(`/visits?demoUser=${SECOND_CUSTOMER}`);
  await expect(second.getByText(/No visits yet|ご来店予約はまだありません/)).toBeVisible();
  await expect(second.getByTestId('visit')).toHaveCount(0);

  // Signing the second customer in changed nothing for the first: looking again, they still have their visit.
  await first.reload();
  await expect(firstVisit).toBeVisible();
});

/**
 * VITE_LINE_OA_ID, as these tests see it. Vite builds it into the app, so it has to be the app's too: `npm run test:e2e`
 * reads app/.env, as the app does, and the app Playwright starts runs with the tests' environment. For the other case,
 * stop the app on :3004 and put the setting before the command, as `VITE_LINE_OA_ID= npm run test:e2e` for unset: a
 * value set there, empty too, wins over app/.env for Node and for Vite. The tests never print it.
 */
const LINE_OA_ID = (process.env.VITE_LINE_OA_ID ?? '').trim();

/** The screen's one "Chat with Maison on LINE", linking to LINE's chat with the basic ID, checked without printing it. */
const expectLineChat = async (page: Page) => {
  const button = page.getByTestId('line-chat');
  await expect(button).toHaveCount(1);
  // The plain words: these tests run on the LIFF mock, which is never asked whether the customer has added Maison. Read
  // and compared here, as the href is: toHaveText's call log would print the element, its href and the basic ID with it.
  const text = (await button.textContent()) ?? '';
  expect(/^(Chat with Maison on LINE|LINEでMaisonにメッセージ)$/.test(text), 'the button has the plain words, "Chat with Maison on LINE"').toBe(true);
  const href = `https://line.me/R/ti/p/%40${LINE_OA_ID.slice(1)}`;
  expect((await button.getAttribute('href')) === href, 'the button links to https://line.me/R/ti/p/ and the encoded basic ID').toBe(true);
};

/** No button on the screen, no link to LINE's chat or add-friend screens, and none of the button's words. */
const expectNoLineChat = async (page: Page) => {
  await expect(page.getByTestId('line-chat')).toHaveCount(0);
  await expect(page.locator('a[href^="https://line.me/"]')).toHaveCount(0);
  await expect(page.getByText(/Maison chat|Add Maison on LINE|MaisonのLINEトーク|Maisonを友だち追加/)).toHaveCount(0);
};

test.describe('Chat with Maison on LINE', () => {
  test("a new booking, My visits and a visit's page link to the chat with Maison", async ({ page }) => {
    test.skip(!LINE_OA_ID, 'VITE_LINE_OA_ID is unset: the next test is the one for that');
    expect(LINE_OA_ID.startsWith('@'), 'VITE_LINE_OA_ID is a basic ID, with its @').toBe(true);
    // A customer of their own: the default one has the other tests' open requests.
    await page.goto(`/?demoUser=${LINE_CHAT_CUSTOMER}`);
    const reference = await bookWeekender(page);
    // Right after the booking, next to "Request sent": the screen's one button.
    await expect(page.getByText(/^(Request sent\. The boutique will confirm on LINE\.|リクエストを送りました。ブティックからLINEで確定のご連絡があります。)$/)).toBeVisible();
    await expectLineChat(page);
    // My visits, later: under the list, after its line.
    await page.goto('/visits');
    const visit = page.getByTestId('visit').filter({ hasText: reference });
    await expect(visit).toBeVisible();
    await expect(page.getByText(/^(Your confirmation arrives in the Maison chat\.|確定のご連絡はMaisonのLINEトークにお届けします。)$/)).toBeVisible();
    await expectLineChat(page);
    // The visit's page.
    await visit.click();
    await expect(page).toHaveURL(new RegExp(`/visits/${reference}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Ginza|銀座/);
    await expectLineChat(page);
  });

  test("without VITE_LINE_OA_ID there's no button, after a booking, on My visits or on a visit's page", async ({ page }) => {
    test.skip(Boolean(LINE_OA_ID), 'VITE_LINE_OA_ID is set: the test before is the one for that');
    await page.goto(`/?demoUser=${LINE_CHAT_CUSTOMER}`);
    const reference = await bookWeekender(page);
    await expect(page.getByText(/Request sent|リクエストを送りました/)).toBeVisible();
    await expectNoLineChat(page);
    await page.goto('/visits');
    const visit = page.getByTestId('visit').filter({ hasText: reference });
    await expect(visit).toBeVisible();
    await expectNoLineChat(page);
    await visit.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Ginza|銀座/);
    await expectNoLineChat(page);
  });
});

// LINE's MINI App safe area. On a phone the app fills the screen, without the phone-sized frame it draws on a laptop:
// emulating a phone makes the pointer coarse, which is what turns that frame off.
test.describe('a phone in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("keeps LINE's safe area: 34 px at the bottom", async ({ page }) => {
    await page.goto('/');
    const area = page.getByTestId('app-area');
    await expect(area).toHaveCSS('padding-bottom', '34px');
    await expect(area).toHaveCSS('padding-left', '0px');
  });
});

test.describe('a phone in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test("fills the screen inside LINE's safe area: 44 px at the sides, 21 px at the bottom", async ({ page }) => {
    await page.goto('/');
    const area = page.getByTestId('app-area');
    await expect(area).toHaveCSS('padding-left', '44px');
    await expect(area).toHaveCSS('padding-right', '44px');
    await expect(area).toHaveCSS('padding-bottom', '21px');
    expect((await area.boundingBox())?.width).toBe(844);
  });
});

test('an address with no screen shows the not-found page, with a link back to the start', async ({ page }) => {
  await page.goto('/no/such/place');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Page not found|ページが見つかりません)$/);
  await page.getByRole('link', { name: /Back to the start|トップへ戻る/ }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:3004\/(\?.*)?$/);
  await expect(page.getByTestId('collection-card').first()).toBeVisible();
});
