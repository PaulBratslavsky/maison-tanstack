import { fitUnits } from './text';

/*
 * What staff are told, and what a row records, when Strapi messages a customer on LINE. A question's staff messages and
 * an inquiry's reply say it the same way, so they share it.
 */

/** Why nothing can be sent when Strapi has no channel access token. */
export const NO_TOKEN = "LINE_CHANNEL_ACCESS_TOKEN isn't set: Strapi can't message customers on LINE.";

/**
 * What a row records, as its `detail` or `lineDetail`, when its customer is one of Load demo activity's made-up
 * customers: Strapi sends them nothing, and records the outcome `demo` with this.
 */
export const DEMO_DETAIL = 'Demo customer: no LINE message';

/** What a row's `lineDetail` holds, in UTF-16 units: its `maxLength`, on a question and on an inquiry. */
const DETAIL_LENGTH = 500;

/**
 * `text` with every copy of the token taken out: nothing Strapi records, logs or shows staff may carry it. Without a
 * token (a demo customer's action needs none) there's nothing to take out.
 */
const withoutToken = (text: string, token: string | null): string => (token ? text.split(token).join('[token]') : text);

/** What went wrong, from whatever was thrown, without the token. */
export const reasonOf = (error: unknown, token: string | null): string => withoutToken(String((error as Error | undefined)?.message ?? error), token);

/**
 * LINE's refusal, or why LINE couldn't be reached, as a row records it and staff read it: without the token, on one line,
 * and cut to what `lineDetail` holds. The token comes out before the cut, so a cut can't leave a piece of it behind.
 */
export const lineDetailOf = (detail: string, token: string): string => fitUnits(withoutToken(detail, token), DETAIL_LENGTH);
