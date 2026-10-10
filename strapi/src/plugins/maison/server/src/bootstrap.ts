import type { Core } from '@strapi/strapi';

import { demoLineUserIdProblem, getConfig } from './config';
import { PLUGIN_ID } from './constants';

/**
 * What the plugin does at boot with only its services: two warnings about settings, and the labelling cron job.
 * Task 2D adds the RBAC actions, which must be registered here (`registerMany` throws once Strapi is loaded), and the
 * customer-session error middleware.
 */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const demoUserProblem = demoLineUserIdProblem((strapi.config.get(`plugin::${PLUGIN_ID}`) as { demoLineUserId?: unknown } | undefined)?.demoLineUserId);
  if (demoUserProblem) strapi.log.warn(demoUserProblem);
  if (!getConfig(strapi).liffUrl) {
    strapi.log.warn('[maison] config.liffUrl is not set, so pending_confirmations will return not_configured.');
  }

  // Labels inquiries every minute, as Pulse's analysisSweep does. With AI off, the sweep only marks new rows skipped.
  strapi.cron.add({
    'maison-label-inquiries': {
      task: async ({ strapi: app }) => {
        try {
          await app.plugin(PLUGIN_ID).service('labelling').sweep();
        } catch (error) {
          app.log.error(`[maison] The labelling sweep crashed: ${(error as Error).message}`);
        }
      },
      options: { rule: '* * * * *' },
    },
  });
};

export default bootstrap;
