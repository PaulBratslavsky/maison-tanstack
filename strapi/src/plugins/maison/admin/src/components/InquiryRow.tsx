import * as React from 'react';

import { Badge, Box, Button, Flex, MenuItem, SimpleMenu, Td, Tr, Typography } from '@strapi/design-system';
import { CaretDown, CaretUp } from '@strapi/icons';

import {
  CLOSE_REASON_OPTIONS,
  canClose,
  canLabelAgain,
  canReplyTo,
  handOffText,
  kindLabel,
  labelNote,
  sentimentText,
  statusLabel,
  type CloseReason,
  type StaffInquiry,
} from '../inquiries';
import { LINE_NOTE_COLORS, lineNote } from '../line-note';
import { askedAt } from '../questions';
import type { Acting, Action } from '../useInquiryActions';
import { CLAMPED_TEXT_STYLE } from './clampedText';
import { YourLineBadge } from './YourLineBadge';

const STATUS_BADGES = { open: 'warning', replied: 'success', closed: 'neutral' } as const;
const KIND_BADGES = { question: 'primary', complaint: 'danger', praise: 'success', other: 'secondary' } as const;
const SENTIMENT_COLORS = { positive: 'success600', neutral: 'neutral800', negative: 'danger600' } as const;
/** The table keeps its cells on one line, so the customer's words wrap instead, within about 24rem, and scroll when they are long. */
const TEXT = { display: 'block', maxWidth: '24rem', style: CLAMPED_TEXT_STYLE } as const;
/** LINE's reasons, the model's words and a hand-off's question wrap within about 18rem. */
const WRAPPED = { display: 'block', maxWidth: '18rem', style: { whiteSpace: 'normal', overflowWrap: 'break-word' } } as const;

interface InquiryRowProps {
  inquiry: StaffInquiry;
  /** Whether the admin may reply to customers, close inquiries and change labels. */
  canReply: boolean;
  /** What is on its way to the server, for any row: nothing else can be sent until it is back. */
  acting: Acting | null;
  onReply: () => void;
  onCloseInquiry: (reason: CloseReason) => void;
  onChangeLabel: () => void;
  onLabelAgain: () => void;
}

/** One inquiry: what the customer wrote, the model's labels, where it stands, and the buttons that apply to it. */
export const InquiryRow = ({ inquiry, canReply, acting, onReply, onCloseInquiry, onChangeLabel, onLabelAgain }: InquiryRowProps) => {
  /** Whether "What the concierge said" is open. The row keeps it across the 5-second refreshes, which keep its key. */
  const [showReply, setShowReply] = React.useState(false);
  const busy = acting !== null;
  const isActing = (action: Action) => acting?.documentId === inquiry.documentId && acting.action === action;
  const note = labelNote(inquiry);
  /** The last LINE message: a failure in red, in LINE's words, or a made-up demo customer, who gets none, in grey. */
  const line = lineNote(inquiry.line);

  return (
    <Tr>
      <Td>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography>{askedAt(inquiry.createdAt)}</Typography>
          <Typography variant="pi" textColor="neutral600">
            {inquiry.customer}
          </Typography>
          <YourLineBadge yourLine={inquiry.yourLine} />
        </Flex>
      </Td>
      <Td>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          {/* The customer's own words, as plain text. */}
          <Typography {...TEXT}>{inquiry.message}</Typography>
          <Button
            variant="ghost"
            size="S"
            aria-expanded={showReply}
            endIcon={showReply ? <CaretUp aria-hidden /> : <CaretDown aria-hidden />}
            onClick={() => setShowReply(!showReply)}
          >
            What the concierge said
          </Button>
          {showReply && (
            <Box background="neutral100" padding={3} hasRadius maxWidth="24rem">
              <Flex direction="column" alignItems="stretch" gap={2}>
                {inquiry.reply ? (
                  <Typography {...TEXT}>{inquiry.reply}</Typography>
                ) : (
                  <Typography textColor="neutral600">The concierge gave no reply.</Typography>
                )}
                {/* The labels are a model's, and so are its reason and topic: they are never shown as a person's words. */}
                {inquiry.topic && (
                  <Typography variant="pi" textColor="neutral600" {...WRAPPED}>
                    The model's topic: {inquiry.topic}
                  </Typography>
                )}
                {inquiry.reason && (
                  <Typography variant="pi" textColor="neutral600" {...WRAPPED}>
                    The model's reason: {inquiry.reason}
                  </Typography>
                )}
              </Flex>
            </Box>
          )}
        </Flex>
      </Td>
      <Td>
        <Typography>{inquiry.product?.name ?? '-'}</Typography>
      </Td>
      <Td>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Badge variant={inquiry.kind ? KIND_BADGES[inquiry.kind] : 'neutral'}>{kindLabel(inquiry.kind)}</Badge>
          {/* An inquiry with no labels at all has nothing to say about its sentiment: the badge and the note do. */}
          {(inquiry.kind !== null || inquiry.sentimentLabel !== null) && (
            <Typography textColor={inquiry.sentimentLabel ? SENTIMENT_COLORS[inquiry.sentimentLabel] : 'neutral600'}>
              {sentimentText(inquiry.sentimentScore, inquiry.sentimentLabel)}
            </Typography>
          )}
          {note && (
            <Typography variant="pi" textColor="neutral600">
              {note}
            </Typography>
          )}
        </Flex>
      </Td>
      <Td>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Badge variant={STATUS_BADGES[inquiry.status]}>{statusLabel(inquiry)}</Badge>
          {/* A hand-off is answered under Questions, so there is no Reply on LINE for it: this says where to go. */}
          {inquiry.question && (
            <Typography variant="pi" textColor="neutral600" {...WRAPPED}>
              {handOffText(inquiry.question)}
            </Typography>
          )}
          {line && (
            <Typography variant="pi" textColor={LINE_NOTE_COLORS[line.tone]} {...WRAPPED}>
              {line.text}
            </Typography>
          )}
        </Flex>
      </Td>
      {canReply && (
        <Td>
          <Flex gap={2} wrap="wrap">
            {canReplyTo(inquiry) && (
              <Button size="S" disabled={busy} onClick={onReply}>
                Reply on LINE
              </Button>
            )}
            {canClose(inquiry) && (
              <SimpleMenu label="Close" size="S" variant="tertiary" loading={isActing('close')} disabled={busy}>
                {CLOSE_REASON_OPTIONS.map(({ value, label }) => (
                  <MenuItem key={value} onSelect={() => onCloseInquiry(value)}>
                    {label}
                  </MenuItem>
                ))}
              </SimpleMenu>
            )}
            <Button size="S" variant="tertiary" disabled={busy} onClick={onChangeLabel}>
              Change label
            </Button>
            {canLabelAgain(inquiry) && (
              <Button size="S" variant="tertiary" loading={isActing('label-again')} disabled={busy} onClick={onLabelAgain}>
                Label again
              </Button>
            )}
          </Flex>
        </Td>
      )}
    </Tr>
  );
};
