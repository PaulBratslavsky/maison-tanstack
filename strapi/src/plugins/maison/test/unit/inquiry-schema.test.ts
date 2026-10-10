import { contentTypes as strapiContentTypes } from '@strapi/utils';
import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';
import schema from '../../server/src/content-types/inquiry/schema.json';
import {
  ANALYSIS_STATUSES,
  CLOSE_REASONS,
  INQUIRY_KINDS,
  INQUIRY_QUEUES,
  INQUIRY_STATUSES,
  INQUIRY_VIA,
  LOCALES,
  SENTIMENT_LABELS,
  UID,
} from '../../server/src/constants';
import { labelsSchema } from '../../server/src/domain/inquiry-criteria';

describe('the inquiry content type', () => {
  it('is registered as plugin::maison.inquiry', () => {
    expect(contentTypes.inquiry.schema).toBe(schema);
    expect(UID.inquiry).toBe(`plugin::maison.${schema.info.singularName}`);
  });

  it('allows exactly the kinds, sentiments, statuses, queues, close reasons and channels in constants.ts', () => {
    const { attributes } = schema;
    expect(attributes.kind.enum).toEqual([...INQUIRY_KINDS]);
    expect(attributes.sentimentLabel.enum).toEqual([...SENTIMENT_LABELS]);
    expect(attributes.analysisStatus.enum).toEqual([...ANALYSIS_STATUSES]);
    expect(attributes.queue.enum).toEqual([...INQUIRY_QUEUES]);
    expect(attributes.status.enum).toEqual([...INQUIRY_STATUSES]);
    expect(attributes.closeReason.enum).toEqual([...CLOSE_REASONS]);
    expect(attributes.via.enum).toEqual([...INQUIRY_VIA]);
  });

  it("allows the languages Maison writes in, Japanese and English, like the locales' own list, and defaults to Japanese", () => {
    expect(schema.attributes.language.enum).toEqual(['ja', 'en']);
    expect(schema.attributes.language.enum).toEqual([...LOCALES]);
    expect(schema.attributes.language.default).toBe('ja');
  });

  // Strapi reserves `locale`: its i18n plugin replaces that attribute on every content type, so the chat's language is stored as `language`.
  it('uses no attribute name that Strapi reserves for itself', () => {
    const reserved = Object.keys(schema.attributes).filter((name) =>
      strapiContentTypes.isReservedAttributeName(name, { draftAndPublish: schema.options.draftAndPublish })
    );
    expect(reserved).toEqual([]);
  });

  it('gives a new row its defaults: from the concierge, pending with no attempts, open, in no queue, and not handed off', () => {
    const { attributes } = schema;
    expect(attributes.via.default).toBe('concierge');
    expect(attributes.analysisStatus.default).toBe('pending');
    expect(attributes.analysisAttempts.default).toBe(0);
    expect(attributes.humanCorrected.default).toBe(false);
    expect(attributes.queue.default).toBe('none');
    expect(attributes.status.default).toBe('open');
    expect(attributes.knowledgeFound.default).toBe(false);
    expect(attributes.handedOff.default).toBe(false);
  });

  // Postgres returns a decimal as a string, and the sentiment score reaches staff as a number.
  it('stores the sentiment score as a float', () => {
    expect(schema.attributes.sentimentScore.type).toBe('float');
  });

  it('has no draft and publish, and is not localized', () => {
    expect(schema.options.draftAndPublish).toBe(false);
    expect((schema.pluginOptions as Record<string, { localized?: boolean } | undefined>).i18n?.localized ?? false).toBe(false);
  });

  it('is hidden from the Content Manager and the Content-Type Builder: staff work on the Maison page', () => {
    expect(schema.pluginOptions['content-manager'].visible).toBe(false);
    expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
  });

  it("keeps the customer's identity out of API responses, the Content Manager's views, every admin API answer and its list search", () => {
    const { customer } = schema.attributes;
    expect(customer.private).toBe(true);
    expect(customer.visible).toBe(false);
    expect(customer.searchable).toBe(false);
    expect(schema.config.attributes.customer.hidden).toBe(true);
  });

  it('holds a reason and a topic as long as the labels allow, and no longer', () => {
    const { reason, topic } = schema.attributes;
    const label = { kind: 'question', sentimentScore: 0, sentimentLabel: 'neutral', answered: true };
    const accepts = (fields: { reason: string; topic: string }) => labelsSchema.safeParse({ ...label, ...fields }).success;
    expect(accepts({ reason: 'r'.repeat(reason.maxLength), topic: 't'.repeat(topic.maxLength) })).toBe(true);
    expect(accepts({ reason: 'r'.repeat(reason.maxLength + 1), topic: 't' })).toBe(false);
    expect(accepts({ reason: 'r', topic: 't'.repeat(topic.maxLength + 1) })).toBe(false);
  });
});
