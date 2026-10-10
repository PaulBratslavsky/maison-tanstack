import * as React from 'react';

import { Box, Button, Field, Flex, Modal, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';

import {
  KIND_OPTIONS,
  SENTIMENT_OPTIONS,
  canSaveLabels,
  kindNeededNotice,
  labelBody,
  labelForm,
  type LabelBody,
  type StaffInquiry,
} from '../inquiries';
import { CLAMPED_TEXT_STYLE } from './clampedText';

const HINT = "Your label replaces the model's, and the model won't label this inquiry again.";

/**
 * Change label: the customer's message, and a select each for the kind and the sentiment, which start at the
 * inquiry's own labels. It sends nothing itself: `onSave` gets only what staff changed, and whoever opened the dialog
 * posts it and closes the dialog once it went.
 */
export const ChangeLabelDialog = ({
  inquiry,
  sending,
  onSave,
  onClose,
}: {
  inquiry: StaffInquiry;
  /** True from the click on Save label until the answer comes back. Nothing in the dialog can be pressed then, and it stays open. */
  sending: boolean;
  onSave: (body: LabelBody) => void;
  onClose: () => void;
}) => {
  const [form, setForm] = React.useState(() => labelForm(inquiry));

  return (
    <Modal.Root
      open
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      {/* A click on the backdrop mustn't close the dialog and drop what was picked. Cancel, the cross and Escape still do. */}
      <Modal.Content onInteractOutside={(event) => event.preventDefault()}>
        <Modal.Header>
          <Modal.Title>Change label</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            {/* The customer's own words, as plain text. */}
            <Box background="neutral100" padding={4} hasRadius>
              <Typography display="block" style={CLAMPED_TEXT_STYLE}>
                &ldquo;{inquiry.message}&rdquo;
              </Typography>
            </Box>

            <Typography variant="pi" textColor="neutral600">
              {HINT}
            </Typography>

            {/* A sentiment alone isn't saved for an inquiry with no kind: the notice says why Save label is disabled, in the server's words. */}
            <Field.Root error={kindNeededNotice(form, inquiry) ?? undefined}>
              <Field.Label>Kind</Field.Label>
              <SingleSelect
                value={form.kind}
                placeholder="Not labelled"
                disabled={sending}
                onChange={(value) => setForm({ ...form, kind: String(value) })}
              >
                {KIND_OPTIONS.map(({ value, label }) => (
                  <SingleSelectOption key={value} value={value}>
                    {label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Error />
            </Field.Root>

            <Field.Root>
              <Field.Label>Sentiment</Field.Label>
              <SingleSelect
                value={form.sentimentLabel}
                placeholder="Not labelled"
                disabled={sending}
                onChange={(value) => setForm({ ...form, sentimentLabel: String(value) })}
              >
                {SENTIMENT_OPTIONS.map(({ value, label }) => (
                  <SingleSelectOption key={value} value={value}>
                    {label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" disabled={sending} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={sending} disabled={sending || !canSaveLabels(form, inquiry)} onClick={() => onSave(labelBody(form, inquiry))}>
            Save label
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
