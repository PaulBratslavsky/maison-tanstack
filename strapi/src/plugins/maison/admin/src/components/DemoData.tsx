import { useEffect, useRef, useState } from 'react';

import { Box, Button, Dialog, Flex, Typography } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import { TOO_SLOW, demoErrorNotice, demoNotice, isStarted, type DemoAction } from '../seed-result';

/**
 * How long after an answer that says the work goes on in the background (or an answer that wasn't JSON) the page loads
 * its lists again, on top of their own 5-second polling.
 */
const REFRESH_AFTER_MS = 4000;

/**
 * Load the catalog, load the made-up customers' activity, or clear the rehearsal's appointments, questions and inquiries.
 * `onChange` lets the board, the counts and the lists refresh at once.
 */
export const DemoData = ({ onChange }: { onChange: () => void }) => {
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [running, setRunning] = useState<DemoAction | null>(null);
  /** The refresh scheduled after a load started in the background, cleared if the page goes away first. */
  const later = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(later.current), []);

  /** Refreshes the lists now, and once more a few seconds later, while the background work fills them. */
  const refreshNowAndLater = () => {
    onChange();
    clearTimeout(later.current);
    later.current = setTimeout(onChange, REFRESH_AFTER_MS);
  };

  /**
   * One button's press. The notice is what the answer says: done, going on in the background (202), or still loading
   * from the last press. An answer that isn't JSON, such as the HTML page Strapi Cloud's proxy gives when a request takes
   * too long, shows a plain message instead of a parse error, and the lists refresh by themselves.
   */
  const run = async (action: DemoAction) => {
    setRunning(action);
    try {
      const { data } = await post<unknown>(`/maison/demo/${action}`);
      const notice = demoNotice(action, data);
      toggleNotification(notice);
      if (isStarted(data) || notice.message === TOO_SLOW) refreshNowAndLater();
      else onChange();
    } catch (error) {
      const notice = demoErrorNotice(error);
      toggleNotification(notice);
      if (notice.message === TOO_SLOW) refreshNowAndLater();
    } finally {
      setRunning(null);
    }
  };

  return (
    <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
      <Flex direction="column" alignItems="flex-start" gap={3}>
        <Typography variant="delta" tag="h2">
          Demo data
        </Typography>
        <Typography variant="omega" textColor="neutral600">
          Load demo catalog creates 3 collections, 12 products and 3 boutiques in Japanese and English, publishes them and sets
          stock, and adds 16 product knowledge entries in Japanese and English. Whatever is there already stays as it is, and
          an English entry without its Japanese version gets one, unless staff changed its title. Load demo activity adds 5
          visit requests, 5 customer questions and 10 inquiries from 5 made-up customers, received over the last 3 days. It
          needs the catalog, and adds nothing when those customers have activity already. Strapi sends the made-up customers
          no LINE message: their rows say "Demo customer". With MAISON_DEMO_LINE_USER_ID set, one waiting request, one open
          question and one complaint go to that LINE account instead, and confirming or replying messages it. Both loads
          answer at once and finish in the background. Reset deletes every appointment, delivery record, customer question and
          inquiry, the demo activity included, and the product knowledge entries that staff added by answering questions. It
          keeps the catalog and the seeded product knowledge, in both languages.
        </Typography>
        <Flex gap={2}>
          <Button loading={running === 'seed'} disabled={running !== null} onClick={() => run('seed')}>
            Load demo catalog
          </Button>
          <Button loading={running === 'activity'} disabled={running !== null} onClick={() => run('activity')}>
            Load demo activity
          </Button>
          {/* Resetting can't be undone, so it asks first. */}
          <Dialog.Root>
            <Dialog.Trigger>
              <Button variant="danger-light" loading={running === 'reset'} disabled={running !== null}>
                Reset demo activity
              </Button>
            </Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Header>Reset demo activity?</Dialog.Header>
              <Dialog.Body icon={<WarningCircle fill="danger600" />}>
                Deletes every appointment, LINE confirmation record, customer question and inquiry, and the product knowledge
                entries that staff added by answering questions. The catalog and the seeded product knowledge stay.
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.Cancel>
                  <Button fullWidth variant="tertiary">
                    Cancel
                  </Button>
                </Dialog.Cancel>
                <Dialog.Action>
                  <Button fullWidth variant="danger-light" onClick={() => run('reset')}>
                    Reset
                  </Button>
                </Dialog.Action>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      </Flex>
    </Box>
  );
};
