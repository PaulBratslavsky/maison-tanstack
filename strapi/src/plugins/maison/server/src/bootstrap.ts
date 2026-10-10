import type { Core } from '@strapi/strapi';

import { demoLineUserIdProblem, getConfig } from './config';
import { PLUGIN_ID } from './constants';
import { answerCustomerSessionErrors } from './policies/customer-session';

const ACTIONS = [
  { uid: 'catalog.read', displayName: 'MCP: browse the catalog', subCategory: 'mcp' },
  { uid: 'appointments.request', displayName: 'MCP: request and view own appointments', subCategory: 'mcp' },
  { uid: 'appointments.review', displayName: 'MCP: review appointment requests', subCategory: 'mcp' },
  { uid: 'appointments.confirm', displayName: 'MCP: confirm appointment requests', subCategory: 'mcp' },
  { uid: 'confirmations.send', displayName: 'MCP: send appointment confirmations', subCategory: 'mcp' },
  { uid: 'questions.ask', displayName: 'MCP: hand questions to staff', subCategory: 'mcp' },
  { uid: 'questions.read', displayName: 'Read customer questions', subCategory: 'questions' },
  { uid: 'questions.answer', displayName: 'Answer customer questions on LINE', subCategory: 'questions' },
  { uid: 'inquiries.log', displayName: 'MCP: log customer inquiries', subCategory: 'mcp' },
  { uid: 'inquiries.view', displayName: 'Review customer inquiries', subCategory: 'inquiries' },
  { uid: 'inquiries.reply', displayName: 'Reply to customer inquiries on LINE', subCategory: 'inquiries' },
  { uid: 'demo.manage', displayName: 'Load and reset demo data', subCategory: 'demo' },
  { uid: 'assistant.use', displayName: 'Use the Maison assistant', subCategory: 'assistant' },
];

/**
 * What the plugin does at boot: it registers its 13 RBAC actions (`registerMany` throws once Strapi is loaded, so it
 * must happen here), adds the customer-session error middleware, warns about two settings, and adds the labelling cron job.
 */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await strapi
    .service('admin::permission')
    .actionProvider.registerMany(ACTIONS.map((action) => ({ section: 'plugins', pluginName: PLUGIN_ID, ...action })));

  // Strapi has added its global middlewares by now and mounts the routes after every bootstrap, so this sits
  // inside its error middleware and around the customer routes' policy.
  strapi.server.use(answerCustomerSessionErrors);

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
