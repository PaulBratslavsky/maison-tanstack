import { Badge, Tooltip } from '@strapi/design-system';

/**
 * The model the chat runs on, as the status names it, for example CLAUDE-SONNET-5-5: the badge draws capitals. The text is the model's
 * ID as it is. Copied from strapi-plugin-tanstack-ai 1.6.0 (`ModelBadge`), with the tooltip "Model" added.
 */
export const ModelBadge = ({ model }: { model: string }) => (
  <Tooltip label="Model">
    <span>
      <Badge>{model}</Badge>
    </span>
  </Tooltip>
);
