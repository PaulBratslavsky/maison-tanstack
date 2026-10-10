import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bootStrapi } from './harness.mjs';

describe('maison permission actions', () => {
  let strapi;
  before(async () => {
    strapi = await bootStrapi('permissions');
  });
  after(async () => {
    await strapi?.destroy();
  });

  it('registers the 13 plugin actions', () => {
    const ids = strapi.service('admin::permission').actionProvider.values().map((action) => action.actionId);
    for (const id of [
      'plugin::maison.catalog.read',
      'plugin::maison.appointments.request',
      'plugin::maison.appointments.review',
      'plugin::maison.appointments.confirm',
      'plugin::maison.confirmations.send',
      'plugin::maison.questions.ask',
      'plugin::maison.questions.read',
      'plugin::maison.questions.answer',
      'plugin::maison.inquiries.log',
      'plugin::maison.inquiries.view',
      'plugin::maison.inquiries.reply',
      'plugin::maison.demo.manage',
      'plugin::maison.assistant.use',
    ]) {
      assert.ok(ids.includes(id), `${id} is registered`);
    }
    assert.equal(ids.filter((id) => id.startsWith('plugin::maison.')).length, 13, 'no other Maison action is registered');
  });
});
