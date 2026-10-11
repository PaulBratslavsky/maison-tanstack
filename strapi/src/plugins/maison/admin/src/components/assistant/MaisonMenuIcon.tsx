import * as React from 'react';

import { Crown } from '@strapi/icons';
import { useRBAC } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { useTheme } from 'styled-components';

import { PERMISSIONS } from '../../permissions';
import { attachHost, detachHost, updateHost } from './assistantHost';
import { claim, owner, release, subscribe } from './menuIconOwner';

/**
 * What the icon that owns the assistant does besides being an icon. It renders nothing. It keeps the host in place for as long as it is on the
 * screen, and tells the host what only Strapi's providers can say: the theme, the language, and whether this admin may use the assistant.
 *
 * `useRBAC` starts from "loading" with every flag false each time an icon is drawn, and Strapi draws the icon again on every change of address.
 * That is not an admin who lost the permission, so nothing is told to the host until the check has answered. The host keeps what it was told
 * last, and the chat stays.
 */
const AssistantFeed = () => {
  const { allowedActions, isLoading } = useRBAC(PERMISSIONS.assistant);
  const theme = useTheme();
  const { locale } = useIntl();
  const allowed = allowedActions.canUse === true;

  React.useEffect(() => {
    attachHost();
    return detachHost;
  }, []);

  React.useEffect(() => {
    if (!isLoading) updateHost({ allowed, theme, locale });
  }, [isLoading, allowed, theme, locale]);

  return null;
};

/**
 * Maison's menu icon: the Crown, as Strapi draws it today, and the way the assistant gets onto every admin page. Strapi draws a menu link's
 * icon on every signed-in page, in the left menu and again in the mobile menu while that is open, so the icon can be on the screen more than
 * once. It claims when it mounts and releases when it unmounts (menuIconOwner.ts), and only the owner, the oldest icon, renders the feed above.
 * So there is one assistant however many icons are drawn, and when the owner goes the next takes over. What the assistant is, and why the
 * icon does not hold it, is in assistantHost.tsx.
 *
 * The props are the ones Strapi gives its icons (`width`, `height` and `fill`, and the accessible icon's `aria-hidden` and `focusable`), and go
 * to the Crown as they come, so the menu looks as it did.
 */
export const MaisonMenuIcon = (props: Omit<React.ComponentProps<typeof Crown>, 'ref'>) => {
  const id = React.useId();
  const current = React.useSyncExternalStore(subscribe, owner, owner);

  React.useEffect(() => {
    claim(id);
    return () => release(id);
  }, [id]);

  return (
    <>
      <Crown {...props} />
      {current === id && <AssistantFeed />}
    </>
  );
};
