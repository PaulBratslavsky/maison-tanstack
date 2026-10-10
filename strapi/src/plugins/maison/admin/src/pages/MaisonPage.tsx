import { useState } from 'react';

import { Box, Flex, Tabs } from '@strapi/design-system';
import { Page, useRBAC } from '@strapi/strapi/admin';
import { useSearchParams } from 'react-router-dom';

import { DemoData } from '../components/DemoData';
import { InquiriesList } from '../components/InquiriesList';
import { PageHeader } from '../components/PageHeader';
import { QuestionsList } from '../components/QuestionsList';
import { RequestCounts } from '../components/RequestCounts';
import { RequestsBoard } from '../components/RequestsBoard';
import { PERMISSIONS } from '../permissions';
import { PAGE_SUBTITLE, selectTab, tabCounts, tabLabel, visibleTabs } from '../tabs';
import { useInquiriesSummary } from '../useInquiriesSummary';
import { useOpenQuestions } from '../useOpenQuestions';
import { useRequestsSummary } from '../useRequestsSummary';

const MaisonPage = () => {
  const { allowedActions, isLoading } = useRBAC(PERMISSIONS.sections);
  const [refreshKey, setRefreshKey] = useState(0);
  // The tab is in the address (`?tab=inquiries`), so a link can open it. With none named, or one the admin may not see,
  // the page opens on the first tab the admin may see.
  const [searchParams, setSearchParams] = useSearchParams();

  // The number on each tab: polled for the admins who may see the tab, whichever tab is open, since staff land on one
  // tab and need to see where the work is on the others. The cards and the lists read these same answers, so each is
  // polled once. `allowedActions` holds only what is granted, so a flag the admin lacks is undefined, never false:
  // `=== true` keeps a hook switched off for them, instead of asking a route that refuses them every 5 seconds.
  const ready = !isLoading;
  const requests = useRequestsSummary(refreshKey, ready && allowedActions.canReview === true);
  const questions = useOpenQuestions(refreshKey, ready && allowedActions.canRead === true);
  const inquiries = useInquiriesSummary(refreshKey, ready && allowedActions.canView === true);

  if (isLoading) return <Page.Loading />;

  /** A new refreshKey makes the board, the counts and the lists load again at once. */
  const refresh = () => setRefreshKey((key) => key + 1);

  // Each tab is for the admins who may see what is in it.
  const tabs = visibleTabs({
    canReview: allowedActions.canReview,
    canRead: allowedActions.canRead,
    canView: allowedActions.canView,
  });
  const activeTab = selectTab(tabs, searchParams.get('tab'));
  const waiting = tabCounts({ requests: requests.summary, questions: questions.count, inquiries: inquiries.summary });

  return (
    <Page.Main>
      <Page.Title>Maison</Page.Title>
      {/*
        The page's side padding, which Layouts.Header and Layouts.Content gave it, for the header and everything under it. The header has 24px above it
        and the tab row sits 8px under it (the gap of the column below). The assistant is not here: it is a drawer, opened from a button on every admin page.
      */}
      <Box paddingLeft={{ initial: 4, medium: 6, large: 10 }} paddingRight={{ initial: 4, medium: 6, large: 10 }}>
        <Flex direction="column" alignItems="stretch" gap={2}>
          <PageHeader title="Maison" subtitle={PAGE_SUBTITLE} />
          <Flex direction="column" alignItems="stretch" gap={8}>
            {activeTab && (
              <Tabs.Root
                variant="simple"
                value={activeTab}
                // The address is replaced, not added to: switching tabs isn't a place to go back to.
                onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}
              >
                <Tabs.List aria-label="Maison">
                  {tabs.map((tab) => (
                    <Tabs.Trigger key={tab} value={tab}>
                      {tabLabel(tab, waiting[tab])}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                {tabs.includes('requests') && (
                  // The counts come from the review route, so only these admins get them.
                  <Tabs.Content value="requests">
                    <Box paddingTop={4}>
                      <Flex direction="column" alignItems="stretch" gap={8}>
                        {requests.summary && <RequestCounts counts={requests.summary.counts} />}
                        <RequestsBoard canConfirm={allowedActions.canConfirm} refreshKey={refreshKey} onChange={refresh} />
                      </Flex>
                    </Box>
                  </Tabs.Content>
                )}
                {tabs.includes('questions') && (
                  <Tabs.Content value="questions">
                    <Box paddingTop={4}>
                      <QuestionsList canAnswer={allowedActions.canAnswer} refreshKey={refreshKey} onChange={questions.reload} />
                    </Box>
                  </Tabs.Content>
                )}
                {tabs.includes('inquiries') && (
                  <Tabs.Content value="inquiries">
                    <Box paddingTop={4}>
                      <InquiriesList
                        canReply={allowedActions.canReply}
                        refreshKey={refreshKey}
                        summary={inquiries.summary}
                        summaryError={inquiries.loadError}
                        onChange={inquiries.reload}
                      />
                    </Box>
                  </Tabs.Content>
                )}
              </Tabs.Root>
            )}
            {allowedActions.canManage === true && <DemoData onChange={refresh} />}
          </Flex>
        </Flex>
      </Box>
    </Page.Main>
  );
};

const ProtectedMaisonPage = () => (
  <Page.Protect permissions={PERMISSIONS.page}>
    <MaisonPage />
  </Page.Protect>
);

export default ProtectedMaisonPage;
