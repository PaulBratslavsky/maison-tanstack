/**
 * A LINE ID with its @: a basic ID (@123abcde) or a premium ID, whose letters, digits, dots, hyphens and underscores
 * need no escaping in a link.
 */
const LINE_ID = /^@[a-z0-9._-]+$/i;

/**
 * "Chat with Maison on LINE" (components/line-chat.tsx): LINE's link to an Official Account, from its basic ID with the
 * @, as VITE_LINE_OA_ID holds it. LINE for iOS and Android open it themselves: a friend lands in the one-on-one
 * chat with Maison, anyone else on the account's add-friend screen (LINE for PC doesn't take LINE's URL scheme).
 * Null when the setting is unset or isn't an @ ID, and then there's no button anywhere.
 */
export const lineChatUrl = (basicId: string | undefined): string | null => {
  const id = basicId?.trim() ?? '';
  return LINE_ID.test(id) ? `https://line.me/R/ti/p/${encodeURIComponent(id)}` : null;
};

/** The longest question a typed-in LINE message carries, so the link stays well within what LINE opens. */
const MAX_TYPED = 500;

/**
 * Half of a surrogate pair on its own, which a model can write and encodeURIComponent throws on. An emoji is a whole
 * pair, and isn't matched. (String.prototype.toWellFormed does this too, but older LIFF in-app browsers lack it.)
 */
const LONE_SURROGATE = /\p{Cs}/gu;

/**
 * LINE's link that opens the chat with Maison with `text` already typed in, for the customer to send: "Send it in the
 * LINE chat" under a hand-off. Once they send it, staff see the chat in LINE Official Account Manager, which on an
 * unverified account lists only customers who have written. Null when the setting is unset or isn't an @ ID. The text is
 * cut to 500 characters, never through one, and a lone half of a surrogate pair in it becomes U+FFFD.
 */
export const lineMessageUrl = (basicId: string | undefined, text: string): string | null => {
  const id = basicId?.trim() ?? '';
  return LINE_ID.test(id)
    ? `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(Array.from(text).slice(0, MAX_TYPED).join('').replace(LONE_SURROGATE, '\uFFFD'))}`
    : null;
};

/**
 * The button's words, and the line above it on My visits (COPY[locale].lineChat), from liff.getFriendship()'s friendFlag
 * (Maison's friendFlag()): a customer who hasn't added Maison yet (false) is asked to add it, which their confirmation
 * needs. A friend (true) gets the chat's words, and so does everyone while the call hasn't answered or when it failed
 * (null): the link is the same, and LINE opens the chat or the add-friend screen as it should.
 */
export const lineChatWords = (
  copy: { button: string; line: string; addButton: string; addLine: string },
  friendFlag: boolean | null
): { button: string; line: string } =>
  friendFlag === false ? { button: copy.addButton, line: copy.addLine } : { button: copy.button, line: copy.line };
