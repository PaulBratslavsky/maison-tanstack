import { Badge, Box, Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';

import { kindLabel, labelNote, sentimentText, statusLabel } from '../inquiries';
import { askedAt } from '../questions';
import { utcTimeAgo } from '../time';
import { useInquiriesSummary } from '../useInquiriesSummary';
import { useNewestInquiries } from '../useNewestInquiries';
import { KIND_BADGES, SENTIMENT_COLORS, STATUS_BADGES } from './inquiryBadges';
import { InquiryCounts } from './InquiryCounts';
import { YourLineBadge } from './YourLineBadge';

/** The names of the Inquiries tab's columns. The tab's Kind column is called "Kind and sentiment": the room here is smaller. */
const COLUMNS = ['Received', 'Customer', 'Message', 'Piece', 'Kind', 'Status'];

/** The Homepage widget of the inquiries: the four open counts, as on the Inquiries tab, and the newest inquiries under them. */
const InquiriesWidget = () => {
  const { summary, loadError: summaryError } = useInquiriesSummary();
  const { inquiries, loadError: listError } = useNewestInquiries();
  const loadError = summaryError ?? listError;

  if (summary === null || inquiries === null) {
    return loadError === null ? <Widget.Loading /> : <Widget.Error>{`Couldn't load the inquiries: ${loadError}`}</Widget.Error>;
  }

  // After a failed refresh, the last result stays on screen with this note, until a refresh works again.
  const staleNote = loadError && (
    <Typography variant="pi" textColor="danger600">
      Couldn't refresh: {loadError}. Showing the last result.
    </Typography>
  );

  // Each refresh renders again, so "12 min ago" moves on with the clock.
  const now = new Date();

  return (
    // Strapi gives the widget's body a fixed 261px and scrolls it as a whole (WidgetRoot). Filling exactly that height
    // keeps the body from scrolling: the cards stay put, and only the table scrolls, inside its own box below them.
    <Flex direction="column" alignItems="stretch" gap={3} height="100%">
      <Box shrink={0}>
        <InquiryCounts counts={summary} />
      </Box>

      {inquiries.length === 0 ? (
        <Widget.NoData>No inquiries yet</Widget.NoData>
      ) : (
        /*
          The table keeps its own width and scrolls sideways inside the widget when that is wider than the widget. Strapi
          sizes the widget's body to its content, so a table that is wider would widen the body and the cards with it. The
          width of 0 makes the table add nothing to that size, and the minimum width of 100% then gives it the widget's.
          Growing into the height left under the cards, with a minimum height of 0, makes this box scroll the rows.
        */
        <Box width="0" minWidth="100%" grow={1} minHeight="0" overflow="auto">
          <Table colCount={COLUMNS.length} rowCount={inquiries.length + 1} aria-label="Newest inquiries">
            <Thead>
              <Tr>
                {COLUMNS.map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{column}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {inquiries.map((inquiry) => {
                const note = labelNote(inquiry);
                return (
                  <Tr key={inquiry.documentId}>
                    <Td title={askedAt(inquiry.createdAt)}>
                      <Typography>{utcTimeAgo(inquiry.createdAt, now)}</Typography>
                    </Td>
                    <Td>
                      <Flex gap={2} alignItems="center">
                        <Typography>{inquiry.customer}</Typography>
                        <YourLineBadge yourLine={inquiry.yourLine} />
                      </Flex>
                    </Td>
                    {/* The customer's own words, as plain text. One line here, and all of it in the tooltip. */}
                    <Td title={inquiry.message || undefined}>
                      <Typography ellipsis maxWidth="16rem">
                        {inquiry.message}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography>{inquiry.product?.name ?? '-'}</Typography>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Badge size="S" variant={inquiry.kind ? KIND_BADGES[inquiry.kind] : 'neutral'}>
                          {kindLabel(inquiry.kind)}
                        </Badge>
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
                      <Badge size="S" variant={STATUS_BADGES[inquiry.status]}>
                        {statusLabel(inquiry)}
                      </Badge>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {staleNote}
    </Flex>
  );
};

export default InquiriesWidget;
