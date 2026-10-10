import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';
import schema from '../../server/src/content-types/knowledge/schema.json';
import { KNOWLEDGE_CATEGORIES, UID } from '../../server/src/constants';

describe('the product knowledge content type', () => {
  it('is registered as plugin::maison.knowledge', () => {
    expect(contentTypes.knowledge.schema).toBe(schema);
    expect(UID.knowledge).toBe(`plugin::maison.${schema.info.singularName}`);
  });

  it('allows exactly the categories in constants.ts', () => {
    expect(schema.attributes.category.enum).toEqual([...KNOWLEDGE_CATEGORIES]);
  });

  it('is localized with draft and publish, and keeps the category and the products the same in every language', () => {
    expect(schema.options.draftAndPublish).toBe(true);
    expect(schema.pluginOptions.i18n.localized).toBe(true);
    for (const field of ['title', 'answer', 'keywords'] as const) expect(schema.attributes[field].pluginOptions.i18n.localized, field).toBe(true);
    for (const field of ['category', 'productSlugs'] as const) expect(schema.attributes[field].pluginOptions.i18n.localized, field).toBe(false);
  });

  it('limits the answer to 2,000 characters', () => {
    expect(schema.attributes.answer.maxLength).toBe(2000);
  });
});
