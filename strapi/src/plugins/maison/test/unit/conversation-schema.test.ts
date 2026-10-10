import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';
import schema from '../../server/src/content-types/conversation/schema.json';
import { UID } from '../../server/src/constants';

describe('the saved chat content type', () => {
  it('is registered as plugin::maison.conversation, in the table maison_conversations', () => {
    expect(contentTypes.conversation.schema).toBe(schema);
    expect(UID.conversation).toBe(`plugin::maison.${schema.info.singularName}`);
    expect(schema.collectionName).toBe('maison_conversations');
  });

  it('has a title, the messages and the admin it belongs to, and the last two are required', () => {
    expect(Object.keys(schema.attributes).sort()).toEqual(['adminUserId', 'messages', 'title']);
    expect(schema.attributes.title.type).toBe('text');
    expect(schema.attributes.messages).toEqual({ type: 'json', required: true });
    expect(schema.attributes.adminUserId).toEqual({ type: 'integer', required: true });
  });

  // A title is cut to 80 characters in code, and a text column has no width of its own to outgrow: a string would be varchar(255) on Strapi Cloud.
  it('keeps the title in a text attribute, with no maxLength to outgrow', () => {
    expect(schema.attributes.title).not.toHaveProperty('maxLength');
  });

  it('has no draft and publish: a saved chat is saved as it is', () => {
    expect(schema.options.draftAndPublish).toBe(false);
  });

  it('is hidden from the screens of the Content Manager and the Content-Type Builder', () => {
    expect(schema.pluginOptions['content-manager'].visible).toBe(false);
    expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
  });

  // `visible: false` hides the type in the admin screens only. A Super Admin can still reach the stored rows through Strapi's Content Manager
  // API, so the description says where an admin can open a chat, and never that nobody else can read it.
  it('says where its admin opens a chat, and does not say that nobody else can read it', () => {
    expect(schema.info.description).toContain('Only that admin can open it in the assistant.');
    expect(schema.info.description).toContain('A chat in the assistant drawer');
    expect(schema.info.description).not.toContain('Ask tab');
    expect(schema.info.description).not.toMatch(/\bread\b/i);
  });
});
