import { useEffect, useLayoutEffect, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';

import { Box, Button, Textarea } from '@strapi/design-system';
import { Cross, Sparkle } from '@strapi/icons';
import styled from 'styled-components';

import { canSend, composerButtons, shouldSendOnKey } from '../../assistant';

/**
 * The composer, copied from strapi-plugin-tanstack-ai 1.6.0 (`ChatInput.tsx`): one row with a line on top, the text box on the left and
 * the buttons on the right. Send is size L with the Sparkle icon. Stop is size L, `danger-light`, with the Cross icon, and sits beside Send
 * while an answer comes.
 *
 * What differs from the reference, on purpose:
 * - The text box is a multi-line `Textarea`: it starts as one line and grows to six, because staff write several lines and Japanese.
 *   Enter sends, Shift+Enter adds a line, and the Enter that confirms a conversion sends nothing (`shouldSendOnKey`).
 * - Send and Stop are two buttons, not one in the same place. A double click on Send lands on a switched-off Send and never on Stop.
 * - The text box stays usable while an answer comes, so the next question can be typed. Only Send waits.
 */
const InputArea = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

interface ComposerProps {
  /** What staff have typed and not sent. It is kept in the provider, so it is still there when staff come back from another tab. */
  draft: string;
  onDraft: (text: string) => void;
  /** Whether an answer is on its way. */
  busy: boolean;
  /** Whether the assistant is set up. */
  ready: boolean;
  /** Send was pressed, or Enter: staff want to send `draft`. Only called when a send would work. */
  onSend: (text: string) => void;
  onStop: () => void;
  /** The text box, so the page can put the focus back in it after a send. */
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export const Composer = ({ draft, onDraft, busy, ready, onSend, onStop, textareaRef }: ComposerProps) => {
  const buttons = composerButtons({ text: draft, busy, ready });

  // The box is one line tall at first and grows with what is typed. The CSS caps it at six lines, and it scrolls beyond that.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }, [draft, textareaRef]);

  // A text box does not measure itself again when its width changes, and the same text takes more or fewer lines at 600px, at 960px and when
  // the window is resized. So the height is measured again when the width changes. A report of the same width is its own height change and is ignored.
  useEffect(() => {
    const box = textareaRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect.width;
      if (next === undefined || next === width) return;
      const first = width === null;
      width = next;
      if (first) return;
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [textareaRef]);

  const submit = () => {
    if (canSend({ text: draft, busy, ready })) onSend(draft);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputArea>
        <Box flex="1">
          <Textarea
            ref={textareaRef}
            aria-label="Chat message"
            placeholder="Type your message..."
            rows={1}
            minHeight="4rem"
            maxHeight="13.6rem"
            paddingTop={2}
            paddingBottom={2}
            resizable={false}
            value={draft}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              // React's synthetic event has no isComposing: it is on the native event. preventDefault runs before the check, so Enter with
              // nothing to send adds no line break either.
              if (shouldSendOnKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Box>
        {/* Two buttons with their own keys. type="button" on Stop: inside the form, a submit button would send the draft instead of stopping the answer. */}
        <Button key="send" type="submit" size="L" startIcon={<Sparkle />} disabled={buttons.sendDisabled}>
          Send
        </Button>
        {buttons.showStop && (
          <Button key="stop" type="button" variant="danger-light" size="L" startIcon={<Cross />} onClick={onStop}>
            Stop
          </Button>
        )}
      </InputArea>
    </form>
  );
};
