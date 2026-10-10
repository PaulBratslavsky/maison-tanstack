import * as React from 'react';

import { Box, Button, Flex, Table, Tbody, Th, Thead, Tr, Typography, VisuallyHidden } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

import {
  DEFAULT_FILTER,
  FILTERS,
  FILTER_LABELS,
  LIST_LIMIT,
  introText,
  noTokenNotice,
  quotaText,
  type InquiriesSummary,
  type InquiryFilter,
  type Quota,
  type StaffInquiry,
} from '../inquiries';
import { startPolling } from '../poll';
import { useInquiryActions } from '../useInquiryActions';
import { useMounted } from '../useMounted';
import { ChangeLabelDialog } from './ChangeLabelDialog';
import { InquiryCounts } from './InquiryCounts';
import { InquiryReplyDialog } from './InquiryReplyDialog';
import { InquiryRow } from './InquiryRow';

const REFRESH_MS = 5000;
const EMPTY: Record<InquiryFilter, string> = {
  'needs-answer': 'No inquiries need an answer.',
  complaint: 'No open complaints.',
  praise: 'No open praise.',
  'not-labelled': 'Every open inquiry has a label.',
  all: 'No inquiries yet.',
};

export const InquiriesList = ({
  canReply,
  refreshKey,
  summary,
  summaryError,
  onChange,
}: {
  canReply: boolean;
  refreshKey: number;
  /** The open counts for the cards, which the page polls: it shows them on the tab's label too. */
  summary: InquiriesSummary | null;
  summaryError: string | null;
  /** Called after an action, so what shows the counts loads them again at once. */
  onChange: () => void;
}) => {
  const { get } = useFetchClient();
  const mounted = useMounted();
  const [filter, setFilter] = React.useState<InquiryFilter>(DEFAULT_FILTER);
  const [inquiries, setInquiries] = React.useState<StaffInquiry[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [quota, setQuota] = React.useState<Quota | null>(null);
  /** The inquiry whose Reply on LINE dialog is open, and the one whose Change label dialog is open. */
  const [replying, setReplying] = React.useState<StaffInquiry | null>(null);
  const [relabelling, setRelabelling] = React.useState<StaffInquiry | null>(null);
  /** The filter on screen, updated the moment staff pick another. A response for any other filter is dropped. */
  const shownFilter = React.useRef<InquiryFilter>(filter);

  // A response that comes back after the tab was left sets nothing: every load, here and in the quota, checks `mounted` first.
  const load = React.useCallback(async (): Promise<void> => {
    const requested = filter;
    try {
      const { data } = await get<{ inquiries?: StaffInquiry[] }>('/maison/inquiries', { params: { filter: requested, limit: LIST_LIMIT } });
      if (!mounted.current || shownFilter.current !== requested) return; // the tab was left, or the filter changed, while this load was in flight
      setInquiries(data.inquiries ?? []);
      setLoadError(null);
    } catch (error) {
      if (mounted.current && shownFilter.current === requested) setLoadError((error as Error).message);
    }
  }, [get, filter, mounted]);

  // The next refresh starts only after the last one finished, so a slow server never gets overlapping requests.
  React.useEffect(() => startPolling(load, REFRESH_MS), [load, refreshKey]);

  /**
   * This month's LINE messages. Each call makes two requests to LINE, so it isn't part of the 5-second refresh: it loads
   * when the tab opens, and again after a reply, which is what changes it.
   */
  const loadQuota = React.useCallback(async (): Promise<void> => {
    try {
      const { data } = await get<Quota>('/maison/inquiries/quota');
      if (mounted.current) setQuota(data);
    } catch {
      // The line is a courtesy: without it, the tab shows nothing about the quota.
    }
  }, [get, mounted]);

  React.useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  /** After an action: the rows and the counts, which it changed, load again. */
  const afterAction = React.useCallback(async (): Promise<void> => {
    await load(); // load reports its own errors
    onChange();
  }, [load, onChange]);
  const { acting, run } = useInquiryActions(afterAction);

  const changeFilter = (value: InquiryFilter) => {
    // The pill that is pressed already: the rows on screen are its rows, and clearing them would blank the table for nothing.
    if (value === filter) return;
    shownFilter.current = value;
    // The rows on screen are the old filter's: they go, and the new filter's rows load at once.
    setInquiries(null);
    setLoadError(null);
    setFilter(value);
  };

  const columns = ['Received', 'Message', 'Piece', 'Kind and sentiment', 'Status'];
  const quotaLine = quota ? quotaText(quota) : '';

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Typography variant="delta" tag="h2">
          Customer inquiries
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {introText(canReply)} Refreshes every {REFRESH_MS / 1000} seconds.{' '}
          {loadError && inquiries !== null ? `Last refresh failed: ${loadError}` : ''}
        </Typography>
      </Flex>

      {summary ? (
        <InquiryCounts counts={summary} />
      ) : (
        summaryError && (
          <Typography variant="pi" textColor="danger600">
            Couldn't load the counts: {summaryError}
          </Typography>
        )
      )}

      {/* The filter on screen is the pressed one. Pills, not tabs: they change what the list shows, not what is on the page. */}
      <Flex role="group" aria-label="Filter inquiries" gap={2} wrap="wrap">
        {FILTERS.map((key) => (
          <Button key={key} size="S" variant={filter === key ? 'default' : 'tertiary'} aria-pressed={filter === key} onClick={() => changeFilter(key)}>
            {FILTER_LABELS[key]}
          </Button>
        ))}
      </Flex>

      {quotaLine && (
        <Typography variant="pi" textColor="neutral600">
          {quotaLine}
        </Typography>
      )}

      {inquiries === null ? (
        loadError ? (
          <Box background="danger100" padding={6} hasRadius>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography textColor="danger700">Couldn't load the inquiries: {loadError}</Typography>
              <Typography variant="pi" textColor="neutral600">
                Trying again every {REFRESH_MS / 1000} seconds.
              </Typography>
            </Flex>
          </Box>
        ) : (
          <Typography textColor="neutral600">Loading inquiries…</Typography>
        )
      ) : inquiries.length === 0 ? (
        <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
          <Typography textColor="neutral600">{EMPTY[filter]}</Typography>
        </Box>
      ) : (
        <>
          <Table colCount={columns.length + (canReply ? 1 : 0)} rowCount={inquiries.length + 1}>
            <Thead>
              <Tr>
                {columns.map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{column}</Typography>
                  </Th>
                ))}
                {canReply && (
                  <Th>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </Th>
                )}
              </Tr>
            </Thead>
            <Tbody>
              {inquiries.map((inquiry) => (
                <InquiryRow
                  key={inquiry.documentId}
                  inquiry={inquiry}
                  canReply={canReply}
                  acting={acting}
                  onReply={() => setReplying(inquiry)}
                  onCloseInquiry={(reason) => run(inquiry.documentId, 'close', { reason })}
                  onChangeLabel={() => setRelabelling(inquiry)}
                  onLabelAgain={() => run(inquiry.documentId, 'label-again')}
                />
              ))}
            </Tbody>
          </Table>
          {inquiries.length >= LIST_LIMIT && (
            <Typography variant="pi" textColor="neutral600">
              Showing the newest {LIST_LIMIT}.
            </Typography>
          )}
        </>
      )}

      {replying && (
        <InquiryReplyDialog
          key={replying.documentId}
          inquiry={replying}
          sending={acting !== null}
          cannotSendBecause={noTokenNotice(quota)}
          onSend={(body) =>
            run(replying.documentId, 'reply', body, () => {
              setReplying(null);
              void loadQuota();
            })
          }
          onClose={() => setReplying(null)}
        />
      )}
      {relabelling && (
        <ChangeLabelDialog
          key={relabelling.documentId}
          inquiry={relabelling}
          sending={acting !== null}
          onSave={(body) => run(relabelling.documentId, 'label', body, () => setRelabelling(null))}
          onClose={() => setRelabelling(null)}
        />
      )}
    </Flex>
  );
};
