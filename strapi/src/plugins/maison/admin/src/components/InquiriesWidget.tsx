import { Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';

import { useInquiriesSummary } from '../useInquiriesSummary';
import { InquiryCounts } from './InquiryCounts';

/** The Homepage widget of the inquiries: the four open counts, as on the Inquiries tab. */
const InquiriesWidget = () => {
  const { summary, loadError } = useInquiriesSummary();

  if (summary === null) {
    return loadError === null ? <Widget.Loading /> : <Widget.Error>{`Couldn't load the inquiries: ${loadError}`}</Widget.Error>;
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3} height="100%">
      <InquiryCounts counts={summary} />
      {/* After a failed refresh, the last counts stay on screen with this note, until a refresh works again. */}
      {loadError && (
        <Typography variant="pi" textColor="danger600">
          Couldn't refresh: {loadError}. Showing the last result.
        </Typography>
      )}
    </Flex>
  );
};

export default InquiriesWidget;
