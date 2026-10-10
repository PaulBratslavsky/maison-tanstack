import * as React from 'react';

import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';

import {
  ANSWER_LIMIT,
  CATEGORY_OPTIONS,
  TITLE_LIMIT,
  answerBody,
  answerTooLong,
  canSendAnswer,
  defaultTitle,
  titleTooLong,
  type AnswerBody,
  type StaffQuestion,
} from '../questions';

const HINT = "It's sent on LINE in your name. With the box ticked, it's also saved as product knowledge, so write it for any customer.";
const TITLE_HINT = 'Customers see this title and your answer in the concierge. Take out anything personal.';
// Sending is refused over these limits, so the dialog says why instead of only disabling Send on LINE.
const ANSWER_TOO_LONG = `An answer can have up to ${ANSWER_LIMIT.toLocaleString('en-US')} characters.`;
const TITLE_TOO_LONG = `A title can have up to ${TITLE_LIMIT} characters.`;

/**
 * Answer: the question, a box for the answer, and whether it also becomes product knowledge, under a title and a
 * category. The title starts as the customer's own question, which staff can edit: customers see it in the concierge.
 * It sends nothing itself: `onSend` gets the body, and whoever opened the dialog posts it and closes the dialog once it went.
 */
export const AnswerDialog = ({
  question,
  sending,
  onSend,
  onClose,
}: {
  question: StaffQuestion;
  /** True from the click on Send on LINE until the answer comes back. Nothing in the dialog can be pressed then, and it stays open. */
  sending: boolean;
  onSend: (body: AnswerBody) => void;
  onClose: () => void;
}) => {
  // Never pre-filled: whatever staff write is what the customer gets. Ticked, because most answers are worth keeping.
  const [text, setText] = React.useState('');
  const [addToKnowledge, setAddToKnowledge] = React.useState(true);
  const [category, setCategory] = React.useState('');
  // The title starts as the question, which is what an entry was titled before staff could write one.
  const [title, setTitle] = React.useState(() => defaultTitle(question.question));
  const form = { text, addToKnowledge, category, title };
  const answerBox = React.useRef<HTMLTextAreaElement>(null);

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <Modal.Content
        // A click on the backdrop mustn't close the dialog and drop what was typed. Cancel, the cross and Escape still do.
        onInteractOutside={(event) => event.preventDefault()}
        // Focus starts in the answer, where staff begin, not on the cross that closes the dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          answerBox.current?.focus();
        }}
      >
        <Modal.Header>
          <Modal.Title>Answer {question.reference}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            {/* The customer's own words, as plain text. */}
            <Box background="neutral100" padding={4} hasRadius>
              <Flex direction="column" alignItems="stretch" gap={1}>
                <Typography display="block" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                  &ldquo;{question.question}&rdquo;
                </Typography>
                {question.product && (
                  <Typography variant="pi" textColor="neutral600">
                    About the {question.product.name}
                  </Typography>
                )}
              </Flex>
            </Box>

            <Field.Root hint={HINT} error={answerTooLong(text) ? ANSWER_TOO_LONG : undefined}>
              <Field.Label>Your answer</Field.Label>
              <Textarea
                ref={answerBox}
                value={text}
                disabled={sending}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>

            <Checkbox checked={addToKnowledge} disabled={sending} onCheckedChange={(checked) => setAddToKnowledge(checked === true)}>
              Add to product knowledge
            </Checkbox>

            {/* Only an answer that becomes product knowledge has a title and a category. */}
            {addToKnowledge && (
              <>
                {/* Public: customers see this title with the answer, so it's shown, and staff can take the customer's words out of it. */}
                <Field.Root hint={TITLE_HINT} error={titleTooLong(title) ? TITLE_TOO_LONG : undefined}>
                  <Field.Label>Title in product knowledge</Field.Label>
                  <TextInput
                    value={title}
                    disabled={sending}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Category</Field.Label>
                  <SingleSelect value={category} disabled={sending} onChange={(value) => setCategory(String(value))}>
                    {CATEGORY_OPTIONS.map(({ value, label }) => (
                      <SingleSelectOption key={value} value={value}>
                        {label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" disabled={sending} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={sending} disabled={!canSendAnswer(form)} onClick={() => onSend(answerBody(form))}>
            Send on LINE
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
