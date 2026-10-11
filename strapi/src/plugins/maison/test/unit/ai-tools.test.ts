import { describe, expect, it, vi } from 'vitest';
import { toChatTool, type McpTool } from '../../server/src/services/ai-tools';
import { searchKnowledgeTool } from '../../server/src/mcp/tools/search-knowledge';
import { searchProductsTool } from '../../server/src/mcp/tools/search-products';
import { viewProductTool } from '../../server/src/mcp/tools/view-product';
import { appointmentRequestsTool } from '../../server/src/mcp/tools/appointment-requests';
import { confirmAppointmentTool } from '../../server/src/mcp/tools/confirm-appointment';
import { fakeStrapi } from './fake-strapi';

/** The tools the assistant takes from the MCP definitions. */
const CATALOG_TOOLS: McpTool[] = [searchKnowledgeTool, searchProductsTool, viewProductTool];

const chatTool = (tool: McpTool, services: Record<string, unknown> = {}) => toChatTool(fakeStrapi({ services }), tool);

describe('toChatTool, one MCP tool as a tool of the staff assistant', () => {
  it('keeps the name, the description and the permission of the MCP tool', () => {
    for (const tool of CATALOG_TOOLS) {
      const adapted = chatTool(tool);
      expect(adapted.name).toBe(tool.name);
      expect(adapted.description).toBe(tool.description);
      expect(adapted.action).toBe('plugin::maison.catalog.read');
    }
    expect(chatTool(appointmentRequestsTool).action).toBe('plugin::maison.appointments.review');
    expect(chatTool(confirmAppointmentTool).action).toBe('plugin::maison.appointments.confirm');
  });

  it('gives a schema that @tanstack/ai can turn into JSON Schema', () => {
    for (const tool of CATALOG_TOOLS) {
      // @tanstack/ai reads zod 4's Standard JSON Schema; a zod 3 schema has none and would reach the model broken.
      const jsonSchema = (chatTool(tool).schema as any)['~standard'].jsonSchema.input({ target: 'draft-07' });
      expect(jsonSchema.type, tool.name).toBe('object');
    }
  });

  it('runs the MCP handler and returns its structured result', async () => {
    const searchProducts = vi.fn(async () => ({ ok: true, value: { total: 0, products: [] } }));
    const tool = chatTool(searchProductsTool, { catalog: { searchProducts } });
    await expect(tool.execute({ occasion: 'travel', locale: 'en' })).resolves.toEqual({ locale: 'en', total: 0, products: [] });
    expect(searchProducts).toHaveBeenCalledWith('en', { occasion: 'travel', locale: 'en' });
  });

  it('unwraps a tool error into { error } with its code, message and hint', async () => {
    const getProduct = vi.fn(async () => null);
    const tool = chatTool(viewProductTool, { catalog: { getProduct } });
    const result = (await tool.execute({ slug: 'no-such-piece' })) as { error: { code: string; message: string; hint: string } };
    expect(result.error.code).toBe('not_found');
    expect(result.error.message).toContain('no-such-piece');
    expect(result.error.hint).toEqual(expect.any(String));
  });

  it('unwraps an error a service gives, for a tool that is not a catalog tool too', async () => {
    const confirm = vi.fn(async () => ({ ok: false, code: 'in_the_past', message: 'The visit has passed.', hint: 'Ask for a new time.' }));
    const tool = chatTool(confirmAppointmentTool, { appointments: { confirm } });
    await expect(tool.execute({ reference: 'APT-4821' })).resolves.toEqual({
      error: { code: 'in_the_past', message: 'The visit has passed.', hint: 'Ask for a new time.' },
    });
  });

  it('answers invalid arguments with invalid_input and never calls the service', async () => {
    const confirm = vi.fn();
    const tool = chatTool(confirmAppointmentTool, { appointments: { confirm } });
    const result = (await tool.execute({ reference: '4821' })) as { error: { code: string; message: string } };
    expect(result.error.code).toBe('invalid_input');
    expect(result.error.message).toBe('reference: Use a reference like APT-4821.');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('adapts only tools that need no MCP handler context and gate on a single permission', () => {
    for (const tool of [...CATALOG_TOOLS, appointmentRequestsTool, confirmAppointmentTool]) {
      // The assistant has no handler context to give, so neither the handler nor the schema resolver may declare the parameter.
      expect(tool.createHandler.length, tool.name).toBe(1);
      expect(tool.resolveInputSchema?.length ?? 0, tool.name).toBe(0);
      // MCP ORs a tool's policies, but the adapter gates on the first one only.
      expect(tool.auth.policies, tool.name).toHaveLength(1);
    }
  });
});
