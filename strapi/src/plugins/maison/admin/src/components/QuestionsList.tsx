import * as React from 'react';

import {
  Badge,
  Box,
  Button,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import { LINE_NOTE_COLORS, lineNote } from '../line-note';
import { startPolling } from '../poll';
import {
  REASON_LABELS,
  askedAt,
  canAnswer as canAnswerQuestion,
  canLetThemKnow,
  replyNotice,
  statusLabel,
  type AnswerBody,
  type QuestionStatus,
  type SentReply,
  type StaffQuestion,
} from '../questions';
import { AnswerDialog } from './AnswerDialog';
import { YourLineBadge } from './YourLineBadge';

type Filter = 'open' | 'answered' | 'all';

const REFRESH_MS = 5000;
const FILTER_LABELS: Record<Filter, string> = { open: 'Open', answered: 'Answered', all: 'All' };
const EMPTY: Record<Filter, string> = { open: 'No open questions.', answered: 'No answered questions yet.', all: 'No questions yet.' };
const STATUS_BADGES: Record<QuestionStatus, 'warning' | 'secondary' | 'success'> = {
  open: 'warning',
  taken: 'secondary',
  answered: 'success',
};
/** The table keeps its cells on one line, so the customer's words and LINE's reasons wrap instead, within about 20rem. */
const WRAPPED = { display: 'block', maxWidth: '20rem', style: { whiteSpace: 'normal', overflowWrap: 'break-word' } } as const;

/** The question's last LINE message: a failure in red, in LINE's words, or a made-up demo customer, who gets none, in grey. */
const LineNoteText = ({ line }: { line: StaffQuestion['line'] }) => {
  const note = lineNote(line);
  if (!note) return null;
  return (
    <Typography variant="pi" textColor={LINE_NOTE_COLORS[note.tone]} {...WRAPPED}>
      {note.text}
    </Typography>
  );
};

/** What is on its way to the customer's LINE chat: Let them know, or an Answer, for one question. */
type Sending = { reference: string; action: 'notify' | 'answer' };

export const QuestionsList = ({
  canAnswer,
  refreshKey,
  onChange,
}: {
  canAnswer: boolean;
  refreshKey: number;
  /** Called after Let them know or Answer went, or was refused, so what shows the number of open questions loads it again at once. */
  onChange?: () => void;
}) => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [filter, setFilter] = React.useState<Filter>('open');
  const [questions, setQuestions] = React.useState<StaffQuestion[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /**
   * From the click until the server has answered and the rows have reloaded, nothing can send another message: the
   * server has no guard against a second click.
   */
  const [sending, setSending] = React.useState<Sending | null>(null);
  /** The question whose Answer dialog is open. */
  const [answering, setAnswering] = React.useState<StaffQuestion | null>(null);
  /** The filter on screen, updated the moment staff pick another. A response for any other filter is dropped. */
  const shownFilter = React.useRef<Filter>(filter);

  const load = React.useCallback(async (): Promise<void> => {
    const requested = filter;
    try {
      const { data } = await get<{ questions?: StaffQuestion[] }>('/maison/questions', { params: { status: requested } });
      if (shownFilter.current !== requested) return; // the filter changed while this load was in flight
      setQuestions(data.questions ?? []);
      setLoadError(null);
    } catch (error) {
      if (shownFilter.current === requested) setLoadError((error as Error).message);
    }
  }, [get, filter]);

  // The next refresh starts only after the last one finished, so a slow server never gets overlapping requests.
  React.useEffect(() => startPolling(load, REFRESH_MS), [load, refreshKey]);

  const changeFilter = (value: Filter) => {
    shownFilter.current = value;
    setFilter(value);
  };

  /**
   * Let them know, or Answer (with its body): Strapi sends the LINE message in the signed-in admin's name. The notice is
   * the server's own message: a warning when it says LINE took the message but something after it went wrong, a
   * success otherwise. A sent answer closes its dialog; a refused one leaves it open, with what was written. Then the
   * list reloads.
   */
  const send = async (reference: string, action: Sending['action'], body?: AnswerBody) => {
    setSending({ reference, action });
    try {
      const { data } = await post<SentReply>(`/maison/questions/${reference}/${action}`, body);
      toggleNotification(replyNotice(data));
      if (action === 'answer') setAnswering(null);
    } catch (error) {
      // Why nothing went out, in the server's words: it's taken or answered already, LINE refused it, or the token is missing.
      toggleNotification({ type: 'danger', message: (error as Error).message });
    }
    onChange?.();
    await load(); // load reports its own errors
    setSending(null);
  };

  const isSending = (question: StaffQuestion, action: Sending['action']) =>
    sending?.reference === question.reference && sending.action === action;

  const columns = ['Reference', 'Asked', 'Customer', 'Piece', 'Question', 'Why', 'Status'];

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex justifyContent="space-between" alignItems="flex-end" gap={4}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="delta" tag="h2">
            Customer questions
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            Questions the concierge handed to Maison's client advisors. Refreshes every {REFRESH_MS / 1000} seconds.{' '}
            {loadError && questions !== null ? `Last refresh failed: ${loadError}` : ''}
          </Typography>
        </Flex>
        <Box width="20rem">
          <SingleSelect aria-label="Question status" size="S" value={filter} onChange={(value) => changeFilter(value as Filter)}>
            {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
              <SingleSelectOption key={key} value={key}>
                {FILTER_LABELS[key]}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
      </Flex>

      {questions === null ? (
        loadError ? (
          <Box background="danger100" padding={6} hasRadius>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography textColor="danger700">Couldn't load the questions: {loadError}</Typography>
              <Typography variant="pi" textColor="neutral600">
                Trying again every {REFRESH_MS / 1000} seconds.
              </Typography>
            </Flex>
          </Box>
        ) : (
          <Typography textColor="neutral600">Loading questions…</Typography>
        )
      ) : questions.length === 0 ? (
        <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
          <Typography textColor="neutral600">{EMPTY[filter]}</Typography>
        </Box>
      ) : (
        <Table colCount={columns.length + (canAnswer ? 1 : 0)} rowCount={questions.length + 1}>
          <Thead>
            <Tr>
              {columns.map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{column}</Typography>
                </Th>
              ))}
              {canAnswer && (
                <Th>
                  <VisuallyHidden>Actions</VisuallyHidden>
                </Th>
              )}
            </Tr>
          </Thead>
          <Tbody>
            {questions.map((question) => (
              <Tr key={question.reference}>
                <Td>
                  <Typography fontWeight="bold">{question.reference}</Typography>
                </Td>
                <Td>
                  <Typography>{askedAt(question.createdAt)}</Typography>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography>{question.customerName || '-'}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {question.customer}
                    </Typography>
                    <YourLineBadge yourLine={question.yourLine} />
                  </Flex>
                </Td>
                <Td>
                  <Typography>{question.product?.name ?? '-'}</Typography>
                </Td>
                {/* The customer's own words, as plain text. */}
                <Td>
                  <Typography {...WRAPPED}>{question.question}</Typography>
                </Td>
                <Td>
                  <Typography>{REASON_LABELS[question.reason]}</Typography>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Badge variant={STATUS_BADGES[question.status]}>{statusLabel(question)}</Badge>
                    {question.addedToKnowledge && (
                      <Typography variant="pi" textColor="neutral600">
                        Added to product knowledge
                      </Typography>
                    )}
                    <LineNoteText line={question.line} />
                  </Flex>
                </Td>
                {canAnswer && (
                  <Td>
                    <Flex gap={2}>
                      {canLetThemKnow(question) && (
                        <Button
                          size="S"
                          variant="secondary"
                          loading={isSending(question, 'notify')}
                          disabled={sending !== null}
                          onClick={() => send(question.reference, 'notify')}
                        >
                          Let them know
                        </Button>
                      )}
                      {canAnswerQuestion(question) && (
                        <Button
                          size="S"
                          loading={isSending(question, 'answer')}
                          disabled={sending !== null}
                          onClick={() => setAnswering(question)}
                        >
                          Answer
                        </Button>
                      )}
                    </Flex>
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {answering && (
        <AnswerDialog
          key={answering.reference}
          question={answering}
          sending={sending !== null}
          onSend={(body) => send(answering.reference, 'answer', body)}
          onClose={() => setAnswering(null)}
        />
      )}
    </Flex>
  );
};
