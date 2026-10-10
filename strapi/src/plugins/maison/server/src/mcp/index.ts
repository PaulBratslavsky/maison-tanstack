import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import type { ToolName } from '../constants';
import { browseCollectionsTool } from './tools/browse-collections';
import { findBoutiquesTool } from './tools/find-boutiques';
import { viewProductTool } from './tools/view-product';
import { searchProductsTool } from './tools/search-products';
import { searchKnowledgeTool } from './tools/search-knowledge';
import { myAppointmentsTool } from './tools/my-appointments';
import { handOffToStaffTool } from './tools/hand-off-to-staff';
import { logInquiryTool } from './tools/log-inquiry';
import { appointmentRequestsTool } from './tools/appointment-requests';
import { confirmAppointmentTool } from './tools/confirm-appointment';
import { requestAppointmentTool } from './tools/request-appointment';
import { sendPendingConfirmationsPrompt } from './prompts/send-pending-confirmations';
import { pendingConfirmationsTool } from './tools/pending-confirmations';
import { recordConfirmationTool } from './tools/record-confirmation';

/** Must run in register(): Strapi locks the MCP capability set when the server starts. */
export const registerMcp = (strapi: Core.Strapi) => {
  if (!strapi.ai?.mcp?.isEnabled()) {
    strapi.log.warn('[maison] server.mcp.enabled is not true, so the Maison MCP tools are not registered.');
    return;
  }
  const { mcp } = strapi.ai;
  const disabled = new Set<string>(getConfig(strapi).disabledTools);
  const enabled = (name: ToolName) => !disabled.has(name);

  let tools = 0;
  /** Registers a tool unless its name is in disabledTools, and counts it. */
  const add = (name: ToolName, register: () => void) => {
    if (!enabled(name)) return;
    register();
    tools += 1;
  };

  add('browse_collections', () => mcp.registerTool(browseCollectionsTool));
  add('search_products', () => mcp.registerTool(searchProductsTool));
  add('view_product', () => mcp.registerTool(viewProductTool));
  add('find_boutiques', () => mcp.registerTool(findBoutiquesTool));
  add('search_knowledge', () => mcp.registerTool(searchKnowledgeTool));
  add('request_appointment', () => mcp.registerTool(requestAppointmentTool));
  add('my_appointments', () => mcp.registerTool(myAppointmentsTool));
  add('hand_off_to_staff', () => mcp.registerTool(handOffToStaffTool));
  add('log_inquiry', () => mcp.registerTool(logInquiryTool));
  add('appointment_requests', () => mcp.registerTool(appointmentRequestsTool));
  add('confirm_appointment', () => mcp.registerTool(confirmAppointmentTool));
  add('pending_confirmations', () => mcp.registerTool(pendingConfirmationsTool));
  add('record_confirmation', () => mcp.registerTool(recordConfirmationTool));
  // The prompt walks the agent through both confirmation tools, so it is useless (and misleading) unless both are registered.
  const prompts = enabled('pending_confirmations') && enabled('record_confirmation') ? 1 : 0;
  if (prompts) mcp.registerPrompt(sendPendingConfirmationsPrompt);
  strapi.log.info(`[maison] MCP registered. Tools: ${tools}. Prompts: ${prompts}.`);
};
