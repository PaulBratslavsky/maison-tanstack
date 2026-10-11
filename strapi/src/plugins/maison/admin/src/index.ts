import { Crown } from '@strapi/icons';
import type { StrapiApp } from '@strapi/strapi/admin';

import { MaisonMenuIcon } from './components/assistant/MaisonMenuIcon';
import { PERMISSIONS } from './permissions';
import { PLUGIN_ID } from './pluginId';

export default {
  register(app: StrapiApp) {
    // The icon is the Crown, and carries the assistant: Strapi draws a menu link's icon on every admin page, and has no other place for something
    // that is on every page. See MaisonMenuIcon.tsx and assistantHost.tsx for how, and for what a Strapi upgrade could break.
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: MaisonMenuIcon,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: 'Maison' },
      Component: () => import('./pages/MaisonPage'),
      permissions: PERMISSIONS.page,
    });

    // The Homepage widget (plugin::maison.requests), shown to admins who can review requests. Its link is an absolute
    // path, as Strapi's own widgets write theirs: the router adds the admin's base path. The menu link above is the
    // other way round, and takes no leading slash.
    app.widgets.register({
      id: 'requests',
      pluginId: PLUGIN_ID,
      icon: Crown,
      title: { id: `${PLUGIN_ID}.widget.requests.title`, defaultMessage: 'Maison requests' },
      link: { label: { id: `${PLUGIN_ID}.widget.requests.link`, defaultMessage: 'Open the board' }, href: `/plugins/${PLUGIN_ID}` },
      permissions: PERMISSIONS.widget,
      component: async () => (await import('./components/RequestsWidget')).default,
    });

    // The second Homepage widget (plugin::maison.inquiries), shown to admins who can review inquiries. It is a widget of
    // its own, not a line in the requests widget: that one's body is laid out for a fixed height. Its link opens the
    // Maison page on the Inquiries tab, which the page picks from `?tab=` (test/unit/admin-widgets.test.ts).
    app.widgets.register({
      id: 'inquiries',
      pluginId: PLUGIN_ID,
      icon: Crown,
      title: { id: `${PLUGIN_ID}.widget.inquiries.title`, defaultMessage: 'Maison inquiries' },
      link: { label: { id: `${PLUGIN_ID}.widget.inquiries.link`, defaultMessage: 'Open the inquiries' }, href: `/plugins/${PLUGIN_ID}?tab=inquiries` },
      permissions: PERMISSIONS.inquiriesWidget,
      component: async () => (await import('./components/InquiriesWidget')).default,
    });

    app.registerPlugin({ id: PLUGIN_ID, name: 'Maison' });
  },
};
