import { describe, expect, it } from 'vitest';
import { registerMcp } from '../../server/src/mcp';
import { TOOL_NAMES } from '../../server/src/constants';
import { fakeMcp, fakeStrapi } from './fake-strapi';

describe('registerMcp', () => {
  it('warns and registers nothing when Strapi MCP is disabled', () => {
    const mcp = fakeMcp(false);
    const strapi = fakeStrapi({ mcp });
    registerMcp(strapi);
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringMatching(/server\.mcp\.enabled/));
    expect(mcp.registerTool).not.toHaveBeenCalled();
    expect(mcp.registerPrompt).not.toHaveBeenCalled();
  });

  it('warns when the host Strapi has no MCP service at all', () => {
    const strapi = fakeStrapi();
    expect(() => registerMcp(strapi)).not.toThrow();
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  it('registers every enabled tool and skips the ones in disabledTools', () => {
    const mcp = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp, config: { disabledTools: ['find_boutiques'] } }));
    const names = mcp.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).toEqual([
      'browse_collections', 'search_products', 'view_product', 'search_knowledge',
      'request_appointment', 'my_appointments', 'hand_off_to_staff', 'log_inquiry', 'appointment_requests', 'confirm_appointment',
      'pending_confirmations', 'record_confirmation',
    ]);
    expect(mcp.registerPrompt.mock.calls.map(([prompt]) => prompt.name)).toEqual(['send_pending_confirmations']);
  });

  it('registers every tool in TOOL_NAMES, in that order, when none is disabled', () => {
    const mcp = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp }));
    expect(mcp.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it('registers hand_off_to_staff, and leaves it out, with the rest registered, when it is in disabledTools', () => {
    const on = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp: on }));
    expect(on.registerTool.mock.calls.map(([tool]) => tool.name)).toContain('hand_off_to_staff');

    const off = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp: off, config: { disabledTools: ['hand_off_to_staff'] } }));
    const names = off.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names).not.toContain('hand_off_to_staff');
    expect(names).toEqual(TOOL_NAMES.filter((name) => name !== 'hand_off_to_staff'));
  });

  it('registers log_inquiry right after hand_off_to_staff, and leaves it out, with the rest registered, when it is in disabledTools', () => {
    const on = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp: on }));
    const names = on.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(names.indexOf('log_inquiry')).toBe(names.indexOf('hand_off_to_staff') + 1);

    const off = fakeMcp(true);
    registerMcp(fakeStrapi({ mcp: off, config: { disabledTools: ['log_inquiry'] } }));
    expect(off.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(TOOL_NAMES.filter((name) => name !== 'log_inquiry'));
  });

  it('registers the confirmation prompt only when both tools it drives are enabled', () => {
    for (const disabledTools of [['record_confirmation'], ['pending_confirmations']]) {
      const mcp = fakeMcp(true);
      registerMcp(fakeStrapi({ mcp, config: { disabledTools } }));
      expect(mcp.registerPrompt, `disabledTools: ${disabledTools}`).not.toHaveBeenCalled();
    }
  });

  it('never claims a name Strapi generates for content types', () => {
    // Content Manager registers list_/get_/create_/update_/delete_/publish_/unpublish_/write_/discard_
    // tools for every content type in the host app (get_product for api::product.product), and a
    // duplicate name stops Strapi from booting.
    const generated = /^(list|get|create|update|delete|publish|unpublish|write|discard)_/;
    expect(TOOL_NAMES.filter((name) => generated.test(name))).toEqual([]);
  });
});
