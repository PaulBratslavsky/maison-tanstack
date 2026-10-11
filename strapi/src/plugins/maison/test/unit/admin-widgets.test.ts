import { describe, expect, it, vi } from 'vitest';
import { MaisonMenuIcon } from '../../admin/src/components/assistant/MaisonMenuIcon';
import plugin from '../../admin/src/index';
import { PERMISSIONS } from '../../admin/src/permissions';
import { selectTab, visibleTabs } from '../../admin/src/tabs';

// Registering needs only the icons as values, and drawing them needs a browser. Maison's menu icon has its own tests (maison-menu-icon.test.tsx).
vi.mock('@strapi/icons', () => ({ Crown: 'Crown' }));
vi.mock('../../admin/src/components/assistant/MaisonMenuIcon', () => ({ MaisonMenuIcon: 'MaisonMenuIcon' }));

/** The admin app as `register` uses it: it keeps what the plugin adds to the menu and to the Homepage. */
const registered = () => {
  const widgets: any[] = [];
  const menuLinks: any[] = [];
  const registerPlugin = vi.fn();
  plugin.register({
    addMenuLink: (link: unknown) => menuLinks.push(link),
    widgets: { register: (widget: unknown) => widgets.push(widget) },
    registerPlugin,
  } as any);
  return { widgets, menuLinks, registerPlugin };
};

describe("the plugin's registration with the admin", () => {
  it('adds Maison to the menu, for the staff who may open the page', () => {
    const { menuLinks } = registered();
    expect(menuLinks).toHaveLength(1);
    expect(menuLinks[0]).toMatchObject({ to: 'plugins/maison', permissions: PERMISSIONS.page });
  });

  // Strapi draws a menu link's icon on every signed-in page, so this icon is how the assistant is on every page (see MaisonMenuIcon.tsx).
  it("draws the menu link with Maison's own icon, which carries the assistant onto every admin page, and not with the plain Crown", () => {
    const { menuLinks } = registered();
    expect(menuLinks[0].icon).toBe(MaisonMenuIcon);
    expect(menuLinks[0].icon).not.toBe('Crown');
  });

  it('keeps the Crown for the two Homepage widgets: the assistant is carried by the menu icon only', () => {
    for (const widget of registered().widgets) expect(widget.icon).toBe('Crown');
  });

  it('adds two Homepage widgets, the requests and the inquiries, each on its own permission', () => {
    const { widgets } = registered();
    expect(widgets.map(({ id }) => id)).toEqual(['requests', 'inquiries']);
    expect(widgets.find(({ id }) => id === 'requests').permissions).toBe(PERMISSIONS.widget);
    expect(widgets.find(({ id }) => id === 'inquiries').permissions).toBe(PERMISSIONS.inquiriesWidget);
    for (const widget of widgets) expect(widget.pluginId).toBe('maison');
  });

  it('words the inquiries widget as Maison inquiries, with the link Open the inquiries', () => {
    const widget = registered().widgets.find(({ id }) => id === 'inquiries');
    expect(widget.title.defaultMessage).toBe('Maison inquiries');
    expect(widget.link.label.defaultMessage).toBe('Open the inquiries');
  });

  // The page opens the tab the address names. A link that misspelt it would open the first tab, with nothing to say so.
  it("links the inquiries widget to the Inquiries tab of the Maison page, which the page opens from that address", () => {
    const { href } = registered().widgets.find(({ id }) => id === 'inquiries').link;

    const address = new URL(href, 'https://admin.test');

    expect(address.pathname).toBe('/plugins/maison');
    expect(selectTab(visibleTabs({ canReview: true, canRead: true, canView: true }), address.searchParams.get('tab'))).toBe('inquiries');
  });

  it("links the requests widget to the Maison page, which opens on the first tab the admin may see", () => {
    const { href } = registered().widgets.find(({ id }) => id === 'requests').link;
    expect(href).toBe('/plugins/maison');
  });

  it('registers the plugin itself', () => {
    expect(registered().registerPlugin).toHaveBeenCalledWith({ id: 'maison', name: 'Maison' });
  });
});
