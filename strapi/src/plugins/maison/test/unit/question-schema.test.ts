import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';
import schema from '../../server/src/content-types/question/schema.json';
import { LOCALES, QUESTION_REASONS, QUESTION_STATUSES, UID } from '../../server/src/constants';

describe('the customer question content type', () => {
  it('is registered as plugin::maison.question', () => {
    expect(contentTypes.question.schema).toBe(schema);
    expect(UID.question).toBe(`plugin::maison.${schema.info.singularName}`);
  });

  it('allows exactly the reasons and statuses in constants.ts', () => {
    expect(schema.attributes.reason.enum).toEqual([...QUESTION_REASONS]);
    expect(schema.attributes.status.enum).toEqual([...QUESTION_STATUSES]);
  });

  it("allows the languages Maison writes in, Japanese and English, like the locales' own list", () => {
    expect(schema.attributes.language.enum).toEqual(['ja', 'en']);
    expect(schema.attributes.language.enum).toEqual([...LOCALES]);
  });

  it('has no draft and publish, and is not localized', () => {
    expect(schema.options.draftAndPublish).toBe(false);
    expect((schema.pluginOptions as Record<string, { localized?: boolean } | undefined>).i18n?.localized ?? false).toBe(false);
  });

  it("is hidden from the Content Manager and the Content-Type Builder: staff work on the Maison page", () => {
    expect(schema.pluginOptions['content-manager'].visible).toBe(false);
    expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
  });

  it("keeps the customer's identity out of API responses", () => {
    expect(schema.attributes.customer.private).toBe(true);
  });

  it("keeps the customer's identity out of every admin API answer and the Content Manager's list search", () => {
    expect(schema.attributes.customer.searchable).toBe(false);
    expect(schema.config.attributes.customer.hidden).toBe(true);
  });

  // The LINE name and the staff name are cut to 100 UTF-16 units before they are stored (fitUnits), which is what these hold.
  it('holds a customer name and a staff name of 100 UTF-16 units, the length they are cut to', () => {
    expect(schema.attributes.customerName.maxLength).toBe(100);
    expect(schema.attributes.staffName.maxLength).toBe(100);
  });
});
