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

  if (enabled('browse_collections')) mcp.registerTool(browseCollectionsTool);
  if (enabled('search_products')) mcp.registerTool(searchProductsTool);
  if (enabled('view_product')) mcp.registerTool(viewProductTool);
  if (enabled('find_boutiques')) mcp.registerTool(findBoutiquesTool);
  if (enabled('search_knowledge')) mcp.registerTool(searchKnowledgeTool);
  if (enabled('request_appointment')) mcp.registerTool(requestAppointmentTool);
  if (enabled('my_appointments')) mcp.registerTool(myAppointmentsTool);
  if (enabled('hand_off_to_staff')) mcp.registerTool(handOffToStaffTool);
  if (enabled('log_inquiry')) mcp.registerTool(logInquiryTool);
  if (enabled('appointment_requests')) mcp.registerTool(appointmentRequestsTool);
  if (enabled('confirm_appointment')) mcp.registerTool(confirmAppointmentTool);
  if (enabled('pending_confirmations')) mcp.registerTool(pendingConfirmationsTool);
  if (enabled('record_confirmation')) mcp.registerTool(recordConfirmationTool);
  // The prompt walks the agent through both confirmation tools, so it is useless (and misleading) unless both are registered.
  if (enabled('pending_confirmations') && enabled('record_confirmation')) mcp.registerPrompt(sendPendingConfirmationsPrompt);
};
