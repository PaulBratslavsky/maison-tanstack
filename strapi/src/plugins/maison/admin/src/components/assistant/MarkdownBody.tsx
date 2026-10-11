import { memo, type ComponentProps } from 'react';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styled from 'styled-components';

import { safeLink } from '../../assistant';

/**
 * The assistant's answer, drawn from Markdown: paragraphs, lists, tables, code, quotes and links. Copied from strapi-plugin-tanstack-ai
 * 1.6.0 (`MarkdownBody` in `MessageList.tsx`), with these changes.
 * - The four tints that were literal black overlays are theme colours, so inline code, code blocks and table headers show in the dark theme.
 * - Lists have their markers and headings their weight. The design system's global style removes both (`list-style: none`, `font: unset`).
 * - Tables. The reference keeps every cell on one line, which is right for a chat the width of a page and wrong for a drawer. Here a header cell stays
 *   on one line, and a body cell wraps its text between words, in a column between 7rem and 22rem wide: a short value (a date, a reference, a masked
 *   customer) keeps its line, and a long text wraps inside its column. A word is broken only when it is longer than the column can be (`overflow-wrap:
 *   break-word`). Never `anywhere` or `break-all`: those shrink every column to a letter or two. The bubble's own `word-break: break-word` is inherited by
 *   the cells, so a body cell sets `word-break: normal` back.
 *   The table is as wide as its columns want to be (`width: max-content`) and is never made to fit the bubble. A browser that makes a table fit
 *   squeezes the columns down to the shortest piece each can break at: it broke `2026-10-05` after its second hyphen and `line:Udec…02` before its last
 *   two characters, in a real browser at 600px. So a table that is wider than the bubble scrolls sideways instead, in a box of its own (`TableScroll`),
 *   and nothing else moves: not the message list, not the drawer, and not the browser's swipe back (`overscroll-behavior-x`). The 7rem and 22rem of the
 *   cells are in the admin's rem, which is 10px because the design system sets the root font size to 62.5%, so a column is 70px to 220px wide.
 * - Images are not drawn, and only an `http:` or `https:` link is a link (see `MarkdownLink`). The model reads customer text, and an image
 *   address or a link could carry other customers' words out of the page.
 * Raw HTML in an answer is shown as text: react-markdown does not render it.
 */
const Body = styled.div`
  p { margin: 0 0 8px; &:last-child { margin-bottom: 0; } }
  ul, ol { margin: 4px 0; padding-left: 20px; }
  ul { list-style: disc; }
  ol { list-style: decimal; }
  li { margin: 2px 0; }
  code {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    background: ${({ theme }) => theme.colors.neutral150};
  }
  pre {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.85em;
    background: ${({ theme }) => theme.colors.neutral150};
    code { padding: 0; background: none; }
  }
  h1, h2, h3, h4 { margin: 12px 0 4px; font-weight: 600; &:first-child { margin-top: 0; } }
  h1 { font-size: 1.3em; } h2 { font-size: 1.15em; } h3 { font-size: 1.05em; }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid ${({ theme }) => theme.colors.neutral300};
    opacity: 0.85;
  }
  a { color: ${({ theme }) => theme.colors.primary600}; }
  /* remark-gfm marks the heading of a footnote section "sr-only": it is for screen readers. The design system has no rule for the class, so it is hidden here. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  table {
    border-collapse: collapse;
    font-size: 0.9em;
    width: max-content;
  }
  th, td {
    border: 1px solid ${({ theme }) => theme.colors.neutral300};
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    white-space: nowrap;
    word-break: normal;
    background: ${({ theme }) => theme.colors.neutral150};
    font-weight: 600;
  }
  td {
    min-width: 7rem;
    max-width: 22rem;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
  }
`;

/**
 * The box a table scrolls sideways in. It is as wide as the answer, and the table in it is as wide as its columns want to be, so a table that does not
 * fit scrolls here and moves nothing else. It keeps the space above and below the table.
 */
const TableScroll = styled.div`
  margin: 8px 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
`;

/** A table in an answer, in its own scroll box. react-markdown passes its own `node` to a custom component, which is left out so it does not land on the element. */
const MarkdownTable = ({ node: _node, ...props }: ComponentProps<'table'> & { node?: unknown }) => (
  <TableScroll>
    <table {...props} />
  </TableScroll>
);

/**
 * A link in an answer. Only an `http:` or `https:` address is a link: it opens in a new tab and gives the page no way back to its window.
 * Anything else is its text, as plain text. react-markdown passes its own `node` to a custom component, which is left out here so it does not
 * land on the element as an attribute.
 */
const MarkdownLink = ({ href, children, node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) => {
  const address = safeLink(href);
  if (!address) return <span>{children}</span>;
  return (
    <a {...props} href={address} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};

const components = { a: MarkdownLink, table: MarkdownTable } as ComponentProps<typeof Markdown>['components'];

/** Memoized: parsing Markdown is the costly part of a streamed answer, and its only prop is a string. An answer whose text did not change is not parsed again. */
export const MarkdownBody = memo(({ text }: { text: string }) => (
  // `data-message-part` is a hook for tests: it lets a check read the rendered answer and nothing else in the message.
  <Body data-message-part="text">
    <Markdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={['img']}>
      {text}
    </Markdown>
  </Body>
));
MarkdownBody.displayName = 'MarkdownBody';
