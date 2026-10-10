import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { bootStrapi, ensureLocales, requireFromApp } from './harness.mjs';

const BOUTIQUE = 'plugin::maison.boutique';
const BAD_HOURS = [{ weekday: 'mon', opens: '20:00', closes: '11:00' }];

// Strapi's error middleware answers 400 only for errors made with the app's own @strapi/utils. This suite runs without any
// step that makes the plugin share that copy. If the plugin loaded a second copy, the first test fails, and so does the second
// (a 500 in place of a 400).
describe('the validation errors of the document middleware', () => {
  let strapi;
  let http;
  let baseUrl;
  const password = `Aa1!${randomBytes(12).toString('hex')}`;
  const email = 'staff@maison.test';

  before(async () => {
    strapi = await bootStrapi('validation-errors');
    await ensureLocales(strapi);
    const superAdmin = await strapi.service('admin::role').getSuperAdmin();
    await strapi.service('admin::user').create({
      email,
      firstname: 'Test',
      lastname: 'Staff',
      password,
      isActive: true,
      roles: [superAdmin.id],
    });
    // The suite's own server on a free port: the app's configured port (1339 in development) stays untouched.
    strapi.server.mount();
    http = createServer(strapi.server.app.callback());
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${http.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => (http ? http.close(resolve) : resolve()));
    await strapi?.destroy();
  });

  it('is a ValidationError of the app\'s own @strapi/utils when a boutique with bad opening hours is created in the Document Service', async () => {
    const { errors } = requireFromApp('@strapi/utils');
    await assert.rejects(
      strapi.documents(BOUTIQUE).create({ locale: 'ja', data: { name: 'x', slug: 'bad-hours', openingHours: BAD_HOURS } }),
      (error) => {
        assert.ok(error instanceof errors.ValidationError, `${error?.name} is not the app's @strapi/utils ValidationError`);
        assert.equal(error.name, 'ValidationError');
        assert.match(error.message, /open before/);
        return true;
      }
    );
  });

  it("answers the Content Manager's create with 400 and the reason, not 500", async () => {
    const login = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const { token } = (await login.json()).data;

    const response = await fetch(`${baseUrl}/content-manager/collection-types/${BOUTIQUE}?locale=ja`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Bad hours', slug: 'bad-hours-http', openingHours: BAD_HOURS }),
    });
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(body.error.name, 'ValidationError');
    assert.match(body.error.message, /open before/);
  });
});
