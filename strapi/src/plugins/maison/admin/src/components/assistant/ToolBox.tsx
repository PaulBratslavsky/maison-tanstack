import { useState } from 'react';

import styled from 'styled-components';

import type { ToolBoxModel } from '../../assistant';

/**
 * One tool call in the chat: a box with a header that opens and closes it, copied from strapi-plugin-tanstack-ai 1.6.0
 * (`ToolCallDisplay.tsx`), without its links to the Content Manager. Closed at first, even while the call runs.
 * - The header shows "Tool: <name>", and at the right a spinner while it runs, then the count ("3 results", "1 result" or "done"), or "failed".
 * - Opened, the body shows the wait, the failure's message, or the result as JSON with the customer-text tags taken out (`toolBoxOf`).
 * - A failed box is marked: a danger border and "failed" in the danger colour. The reference shows only a faint word, and that is not
 *   copied: failures need to be easy to see.
 */
const Frame = styled.div<{ $failed: boolean }>`
  margin-top: 8px;
  border: 1px solid ${({ $failed, theme }) => ($failed ? theme.colors.danger200 : theme.colors.neutral200)};
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;
`;

const Header = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.neutral150};
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.neutral800};
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
  }
`;

const Status = styled.span<{ $failed: boolean }>`
  margin-left: auto;
  font-weight: 400;
  ${({ $failed, theme }) => ($failed ? `color: ${theme.colors.danger600};` : 'opacity: 0.6;')}
`;

const Spinner = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid ${({ theme }) => theme.colors.neutral300};
  border-top-color: ${({ theme }) => theme.colors.primary600};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: auto;
  flex-shrink: 0;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Content = styled.pre`
  margin: 0;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: 11px;
  line-height: 1.4;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

export const ToolBox = ({ box }: { box: ToolBoxModel }) => {
  const [open, setOpen] = useState(false);
  const failed = box.state === 'failed';

  return (
    <Frame $failed={failed} data-message-part="tool" data-state={box.state}>
      <Header type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
        <span>Tool: {box.name}</span>
        {box.state === 'running' ? <Spinner role="progressbar" aria-label="running" /> : <Status $failed={failed}>{box.status}</Status>}
      </Header>
      {open && <Content>{box.body}</Content>}
    </Frame>
  );
};
