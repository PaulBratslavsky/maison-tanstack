/**
 * Reading the CSS styled-components wrote, for the component tests. jsdom has no layout, so a test cannot measure a width or see a word wrap. What it
 * can hold is what the component asked for: each declaration of each rule. The helpers read a declaration by name, on its own, so a test does not
 * depend on the order the declarations were written in, or on the other declarations of the same rule.
 *
 * styled-components writes each rule into a style element of the document, with a generated class for the element. The document keeps the CSS of
 * earlier tests, so the helpers read only the rules whose selector starts with one of the element's own classes.
 */

interface Block {
  /** What comes before the braces: a selector list, or an at-rule such as `@media(min-width: 768px)`. */
  prelude: string;
  /** What is inside the braces. For an at-rule, that is the rules inside it. */
  body: string;
}

/** The blocks at the top level of some CSS. */
const blocksOf = (css: string): Block[] => {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let preludeStart = 0;
  let prelude = '';
  for (let at = 0; at < css.length; at += 1) {
    const char = css[at];
    if (char === '{') {
      if (depth === 0) {
        prelude = css.slice(preludeStart, at).trim();
        start = at + 1;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push({ prelude, body: css.slice(start, at) });
        preludeStart = at + 1;
      }
    }
  }
  return found;
};

/** The declarations in the body of a rule, by property name: `{ 'white-space': 'nowrap' }`. */
const declarationsIn = (body: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    found[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return found;
};

/** All the CSS in the document so far. */
export const allCss = (): string =>
  Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');

/** Whether one selector of a rule is the element's class followed by `suffix`: `' td'` for its cells, `'::after'` for its tooltip, and `''` for the element itself. */
const isFor = (selector: string, element: Element, suffix: string): boolean => Array.from(element.classList).some((name) => selector.trim() === `.${name}${suffix}`);

const collect = (blocks: Block[], element: Element, suffix: string): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const { prelude, body } of blocks) {
    if (prelude.startsWith('@')) continue;
    if (prelude.split(',').some((selector) => isFor(selector, element, suffix))) Object.assign(found, declarationsIn(body));
  }
  return found;
};

/**
 * The declarations styled-components wrote for an element, by property name. `suffix` says what part: nothing for the element itself, `' td'` for the
 * cells inside it, `'::after'` for its tooltip. Where two rules give the same property, the later one wins, as in a browser.
 */
export const declarationsOf = (element: Element, suffix = ''): Record<string, string> => collect(blocksOf(allCss()), element, suffix);

/** The same, for the rules inside a media query, such as `@media (prefers-reduced-motion: reduce)` or `@media(min-width: 768px)`. */
export const mediaDeclarationsOf = (element: Element, query: string, suffix = ''): Record<string, string> => {
  const found: Record<string, string> = {};
  const wanted = query.replace(/\s+/g, '');
  for (const { prelude, body } of blocksOf(allCss())) {
    if (!prelude.startsWith('@media') || prelude.replace(/\s+/g, '').slice('@media'.length) !== wanted) continue;
    Object.assign(found, collect(blocksOf(body), element, suffix));
  }
  return found;
};

/**
 * The queries of the media rules that hold a rule for the element, or for its `suffix` part, with the spaces taken out: `(min-width:768px)`. A test uses
 * it to say that no rule of an element depends on the width of the window, which `declarationsOf` cannot say, as it leaves media rules out.
 */
export const mediaQueriesOf = (element: Element, suffix = ''): string[] => {
  const found = new Set<string>();
  for (const { prelude, body } of blocksOf(allCss())) {
    if (!prelude.startsWith('@media')) continue;
    if (Object.keys(collect(blocksOf(body), element, suffix)).length > 0) found.add(prelude.replace(/\s+/g, '').slice('@media'.length));
  }
  return [...found];
};

/** All the CSS rules of the document that are keyframes, as text. */
export const keyframesCss = (): string =>
  blocksOf(allCss())
    .filter(({ prelude }) => prelude.startsWith('@keyframes'))
    .map(({ prelude, body }) => `${prelude}{${body}}`)
    .join('\n');
