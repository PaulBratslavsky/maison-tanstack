import { describe, expect, it, vi } from 'vitest';
import bootstrap from '../../server/src/bootstrap';
import controllers from '../../server/src/controllers';
import policies from '../../server/src/policies';
import customerSession, { answerCustomerSessionErrors } from '../../server/src/policies/customer-session';
import routes from '../../server/src/routes';
import plugin from '../../server/src';
import { fakeStrapi } from './fake-strapi';

const contentApi = (routes as Record<string, any>)['content-api'];
const route = (method: string, path: string) => contentApi.routes.find((r: any) => r.method === method && r.path === path);
const CUSTOMER_SESSION = 'plugin::maison.customer-session';
const CATALOG_PATHS = ['/collections', '/products', '/products/:slug', '/boutiques', '/knowledge'];

describe('content-API routes (served at /api/maison)', () => {
  it("are the seven REST routes, the catalog's on Strapi's find and findOne actions", () => {
    expect(contentApi.type).toBe('content-api');
    expect(contentApi.routes.map((r: any) => [r.method, r.path, r.handler])).toEqual([
      ['GET', '/collections', 'collections.find'],
      ['GET', '/products', 'products.find'],
      ['GET', '/products/:slug', 'products.findOne'],
      ['GET', '/boutiques', 'boutiques.find'],
      ['GET', '/knowledge', 'knowledge.find'],
      ['POST', '/appointments', 'customer.requestAppointment'],
      ['GET', '/my-appointments', 'customer.myAppointments'],
    ]);
  });

  it('name each catalog action so that a read-only API token may call it', () => {
    // Strapi's content-api-token strategy lets a read-only token through only to scopes ending in find or findOne.
    // A route's scope is plugin::maison.<handler>.
    const readOnlyMayCall = (scope: string) => scope.endsWith('find') || scope.endsWith('findOne');
    for (const path of CATALOG_PATHS) {
      const { handler } = route('GET', path);
      expect(readOnlyMayCall(`plugin::maison.${handler}`), handler).toBe(true);
    }
  });

  it("leave the catalog to Strapi's role and API-token permissions", () => {
    for (const path of CATALOG_PATHS) {
      const { config } = route('GET', path);
      expect(config?.auth, path).toBeUndefined();
      expect(config?.policies, path).toBeUndefined();
    }
  });

  it('let a customer route through only with a LINE customer session, whatever the roles say', () => {
    for (const [method, path] of [['POST', '/appointments'], ['GET', '/my-appointments']]) {
      expect(route(method, path).config).toEqual({ auth: false, policies: [CUSTOMER_SESSION] });
    }
  });

  it('name controller actions that exist', () => {
    const instances = Object.fromEntries(
      Object.entries(controllers).map(([name, factory]) => [name, (factory as any)({ strapi: fakeStrapi() })])
    );
    for (const { handler } of contentApi.routes) {
      const [controller, action] = handler.split('.');
      expect(typeof instances[controller]?.[action], handler).toBe('function');
    }
  });

  it('keep the board and demo admin routes as they were', () => {
    const admin = (routes as any).admin.routes.map((r: any) => `${r.method} ${r.path}`);
    for (const key of ['GET /appointments', 'POST /appointments/:reference/confirm', 'POST /demo/seed', 'POST /demo/reset']) {
      expect(admin).toContain(key);
    }
  });
});

describe('the customer-session policy', () => {
  it('is registered with the plugin as customer-session', () => {
    expect(policies).toEqual({ 'customer-session': customerSession });
    expect(plugin.policies).toBe(policies);
  });

  it("has its refusals answered by a middleware that bootstrap adds inside Strapi's error middleware", async () => {
    const use = vi.fn();
    const strapi = {
      ...fakeStrapi({ config: { liffUrl: 'https://liff.line.me/1234567890-AbCdEfGh' } }),
      service: () => ({ actionProvider: { registerMany: vi.fn() } }),
      server: { use },
    };
    await bootstrap({ strapi } as any);
    expect(use).toHaveBeenCalledWith(answerCustomerSessionErrors);
  });
});
