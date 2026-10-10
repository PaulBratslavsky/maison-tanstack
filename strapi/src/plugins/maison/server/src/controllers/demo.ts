import type { Core } from '@strapi/strapi';

import type { ServiceFailure } from '../domain/service-result';

/** Strapi's error helper for a demo button's failure: 404 for a catalog that isn't loaded, 409 for a load still running, 400 for the rest. */
const fail = (ctx, { code, message, hint }: ServiceFailure) => {
  if (code === 'not_found') return ctx.notFound(message, { code, hint });
  if (code === 'already_loading') return ctx.conflict(message, { code, hint });
  return ctx.badRequest(message, { code, hint });
};

/**
 * The Demo data buttons. Load demo catalog and Load demo activity answer at once: 200 with the "already there" result
 * when there is nothing to add, or 202 with `started: true` and what they will add, which is then written in the
 * background. The admin's fetch client gives the page the body and never the status, so `started` is what tells them apart.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async seed(ctx) {
    const result = await strapi.plugin('maison').service('seed').startDemoCatalog();
    if (result.ok === false) return fail(ctx, result);
    if (result.value.started === false) {
      ctx.body = result.value.result;
      return;
    }
    ctx.status = 202;
    ctx.body = { started: true, ...result.value.counts };
  },
  async reset(ctx) {
    ctx.body = await strapi.plugin('maison').service('seed').resetDemoAppointments();
  },
  /** Load demo activity, at the real time. A catalog that isn't loaded is a 404 that says so, and a press while a load is running a 409. */
  async activity(ctx) {
    const result = await strapi.plugin('maison').service('seed').startDemoActivity();
    if (result.ok === false) return fail(ctx, result);
    if (result.value.started === false) {
      ctx.body = result.value.result;
      return;
    }
    ctx.status = 202;
    ctx.body = { started: true, ...result.value.counts };
  },
});
