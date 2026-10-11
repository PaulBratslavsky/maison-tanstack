import { useEffect, useRef, useState } from 'react';

import { Typography } from '@strapi/design-system';
import styled from 'styled-components';

import { toolNoteOf, type ToolInfo } from '../../assistant';
import { ToolsIcon, TopBarIcon } from './TopBarIcon';

/**
 * What tools the chat has, for staff to read. Copied from strapi-plugin-tanstack-ai 1.6.0 (`ToolSourcePicker.tsx`) without the switches, the
 * saved choice and what goes to the server with each request: Maison's tools are fixed. They are the tools this admin's chat really gets, as
 * the status lists them, so a role that may read less sees less.
 *
 * Each row has the tool's label, one line about it, and its name in a code chip. The popover closes on a click outside it and on Escape. The
 * Escape that closes it goes no further: in the drawer, Escape closes the drawer too, and the first one is for the list.
 */

const Wrapper = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const Popover = styled.div`
  position: absolute;
  top: 36px;
  left: 0;
  z-index: 20;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  padding: 8px 0;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
`;

const Intro = styled.div`
  padding: 2px 12px 8px;
`;

const GroupHeader = styled.div`
  padding: 6px 12px 2px;
`;

const ToolRow = styled.div`
  padding: 6px 12px;
`;

const ToolName = styled.code`
  display: inline-block;
  margin-top: 2px;
  padding: 1px 5px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.neutral150};
  color: ${({ theme }) => theme.colors.neutral700};
  font-size: 11px;
  word-break: break-all;
`;

export const ToolsPopover = ({ tools }: { tools: readonly ToolInfo[] }) => {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Closes on a click outside, and on Escape. Without the key handler, someone who does not use a mouse could not close the list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    // A capture listener runs before React's handlers, so it marks the Escape as used (preventDefault) before the drawer sees it. The drawer
    // ignores an Escape that is marked, so with the list open the first Escape closes the list only, wherever the focus is.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <Wrapper
      ref={wrapper}
      onKeyDown={(event) => {
        // The document's listener above closes the list for an Escape from anywhere. This one is for an Escape from the list or its button:
        // it also stops what is around the list from acting on that Escape.
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <TopBarIcon label={`Tools (${tools.length})`} active={open} expanded={open} onClick={() => setOpen((value) => !value)}>
        <ToolsIcon />
      </TopBarIcon>
      {open && (
        <Popover role="dialog" aria-label="Tools">
          <Intro>
            <Typography variant="pi" textColor="neutral600">
              The assistant looks things up. It never sends, confirms or changes anything.
            </Typography>
          </Intro>
          <GroupHeader>
            <Typography variant="sigma" textColor="neutral600">
              Read only
            </Typography>
          </GroupHeader>
          {tools.length === 0 && (
            <ToolRow>
              <Typography variant="pi" textColor="neutral600">
                Your role has no tools, so the assistant can&apos;t look anything up.
              </Typography>
            </ToolRow>
          )}
          {tools.map((tool) => {
            const note = toolNoteOf(tool.name);
            return (
              <ToolRow key={tool.name}>
                <Typography variant="omega" textColor="neutral800" fontWeight="bold">
                  {tool.label}
                </Typography>
                {note && (
                  <Typography variant="pi" textColor="neutral600" display="block">
                    {note}
                  </Typography>
                )}
                <ToolName>{tool.name}</ToolName>
              </ToolRow>
            );
          })}
        </Popover>
      )}
    </Wrapper>
  );
};
