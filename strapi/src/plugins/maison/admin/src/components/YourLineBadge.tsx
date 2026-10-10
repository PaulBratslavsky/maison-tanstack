import { Badge } from '@strapi/design-system';

import { yourLineBadge } from '../your-line';

/**
 * "Your LINE", beside a customer that is the presenter's own LINE account, and nothing beside any other. The purple
 * "alternative" colour is the one no other badge on the Maison page uses (status, LINE and kind use the others), so it
 * stands out, and the small size keeps it level with the customer's text.
 */
export const YourLineBadge = ({ yourLine }: { yourLine?: boolean }) => {
  const badge = yourLineBadge({ yourLine });
  if (!badge) return null;
  return (
    <Badge size="S" variant="alternative" title={badge.title}>
      {badge.label}
    </Badge>
  );
};
