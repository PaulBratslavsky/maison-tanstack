import { describe, expect, it } from 'vitest';
import appointmentSchema from '../../server/src/content-types/appointment/schema.json';
import { CREATED_VIA } from '../../server/src/constants';
import {
  browseCollectionsInput,
  findBoutiquesInput,
  handOffToStaffInput,
  localeInput,
  logInquiryInput,
  myAppointmentsInput,
  requestAppointmentInput,
  searchKnowledgeInput,
  searchProductsInput,
  staffAppointmentOutput,
  viewProductInput,
} from '../../server/src/mcp/schemas';
import { browseCollectionsTool } from '../../server/src/mcp/tools/browse-collections';
import { findBoutiquesTool } from '../../server/src/mcp/tools/find-boutiques';
import { handOffToStaffTool } from '../../server/src/mcp/tools/hand-off-to-staff';
import { logInquiryTool } from '../../server/src/mcp/tools/log-inquiry';
import { myAppointmentsTool } from '../../server/src/mcp/tools/my-appointments';
import { requestAppointmentTool } from '../../server/src/mcp/tools/request-appointment';
import { searchKnowledgeTool } from '../../server/src/mcp/tools/search-knowledge';
import { searchProductsTool } from '../../server/src/mcp/tools/search-products';
import { viewProductTool } from '../../server/src/mcp/tools/view-product';

const context = { userAbility: {} as any, user: { id: 1 } };

describe('one source of validation for the MCP tools and the REST routes', () => {
  it.each([
    ['browse_collections', browseCollectionsTool, browseCollectionsInput],
    ['search_products', searchProductsTool, searchProductsInput],
    ['view_product', viewProductTool, viewProductInput],
    ['find_boutiques', findBoutiquesTool, findBoutiquesInput],
    ['search_knowledge', searchKnowledgeTool, searchKnowledgeInput],
    ['request_appointment', requestAppointmentTool, requestAppointmentInput],
    ['my_appointments', myAppointmentsTool, myAppointmentsInput],
    ['hand_off_to_staff', handOffToStaffTool, handOffToStaffInput],
    ['log_inquiry', logInquiryTool, logInquiryInput],
  ])('%s validates with the shared schema object', (_name, tool: any, shared) => {
    expect(shared).toBeDefined();
    expect(tool.resolveInputSchema(context)).toBe(shared);
  });

  it('gives every customer tool the same locale input: ja or en, with the default locale when left out', () => {
    for (const shared of [
      browseCollectionsInput, searchProductsInput, viewProductInput, findBoutiquesInput, searchKnowledgeInput, requestAppointmentInput, myAppointmentsInput,
      handOffToStaffInput, logInquiryInput,
    ]) {
      expect(shared.shape.locale).toBe(localeInput);
    }
  });
});

describe('createdVia', () => {
  it('has the same values in the constants, the content type and what staff see', () => {
    expect(CREATED_VIA).toEqual(['concierge', 'app', 'web']);
    expect(appointmentSchema.attributes.createdVia.enum).toEqual([...CREATED_VIA]);
    for (const createdVia of CREATED_VIA) {
      const row = {
        reference: 'APT-4821', status: 'requested', customer: 'line:U4af…88', boutique: null, requestedFor: '2030-01-12T14:00:00+09:00',
        products: [], note: '', createdVia, confirmationSent: false, demoCustomer: false, yourLine: false, createdAt: '2026-10-01T09:00:00+09:00',
      };
      expect(staffAppointmentOutput.parse(row).createdVia).toBe(createdVia);
    }
  });
});
