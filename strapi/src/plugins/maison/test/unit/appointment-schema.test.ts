import { describe, expect, it } from 'vitest';
import contentTypes from '../../server/src/content-types';
import schema from '../../server/src/content-types/appointment/schema.json';
import { UID } from '../../server/src/constants';

describe('the appointment content type', () => {
  it('is registered as plugin::maison.appointment', () => {
    expect(contentTypes.appointment.schema).toBe(schema);
    expect(UID.appointment).toBe(`plugin::maison.${schema.info.singularName}`);
  });

  it("keeps the customer's identity out of API responses and the Content Manager's views", () => {
    expect(schema.attributes.customer.private).toBe(true);
    expect(schema.attributes.customer.visible).toBe(false);
  });

  // Strapi's admin sanitizer returns a field that is only visible: false to any admin API consumer, and drops only a field
  // marked hidden in the schema's config. The list search matches a text field by substring unless it is searchable: false.
  it("keeps the customer's identity out of every admin API answer and the Content Manager's list search", () => {
    expect(schema.attributes.customer.searchable).toBe(false);
    expect(schema.config.attributes.customer.hidden).toBe(true);
  });
});
