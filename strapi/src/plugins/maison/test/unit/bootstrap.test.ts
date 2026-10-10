import { describe, expect, it, vi } from 'vitest';
import bootstrap from '../../server/src/bootstrap';
import { fakeStrapi } from './fake-strapi';

/*
 * What bootstrap does with only the services: the labelling cron job and two warnings. Task 2D adds the RBAC actions
 * and the customer-session middleware, with their tests.
 */

const LIFF = 'https://liff.line.me/1234567890-AbCdEfGh';

/** Strapi after `bootstrap` ran, with `labelling` as the plugin's service of that name. */
const bootstrapped = async (labelling: { sweep: () => Promise<unknown> }, config: Record<string, unknown> = { liffUrl: LIFF }) => {
  const strapi = fakeStrapi({ services: { labelling }, config });
  await bootstrap({ strapi } as any);
  return strapi;
};

const JOB = 'maison-label-inquiries';

/** The one job bootstrap added to Strapi's cron. */
const jobOf = (strapi: Awaited<ReturnType<typeof bootstrapped>>) => {
  expect(strapi.cron.add).toHaveBeenCalledOnce();
  return strapi.cron.add.mock.calls[0][0][JOB];
};

describe('the labelling cron job', () => {
  it(`is the one job bootstrap registers, named ${JOB}, and runs every minute, as Pulse's analysisSweep does`, async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() });

    expect(Object.keys(strapi.cron.add.mock.calls[0][0])).toEqual([JOB]);
    expect(jobOf(strapi).options).toEqual({ rule: '* * * * *' });
    expect(jobOf(strapi).task).toBeTypeOf('function');
  });

  it('runs the labelling sweep each time it fires, and says nothing when it goes well', async () => {
    const sweep = vi.fn(async () => ({ labelled: 1, failed: 0, skipped: 0 }));
    const strapi = await bootstrapped({ sweep });

    await jobOf(strapi).task({ strapi });
    await jobOf(strapi).task({ strapi });

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(strapi.log.error).not.toHaveBeenCalled();
  });

  it('catches a crash and logs it with strapi.log.error, so the job never throws', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn(async () => Promise.reject(new Error('The database is down.'))) });

    await expect(jobOf(strapi).task({ strapi })).resolves.toBeUndefined();

    expect(strapi.log.error).toHaveBeenCalledExactlyOnceWith('[maison] The labelling sweep crashed: The database is down.');
  });
});

describe('the liffUrl warning', () => {
  it('says that pending_confirmations returns not_configured, when liffUrl is not set', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() }, {});

    expect(strapi.log.warn).toHaveBeenCalledExactlyOnceWith('[maison] config.liffUrl is not set, so pending_confirmations will return not_configured.');
  });

  it('treats an empty liffUrl, as an empty env value gives, as not set', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() }, { liffUrl: '' });

    expect(strapi.log.warn).toHaveBeenCalledOnce();
  });

  it('warns about nothing when liffUrl is set', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() });

    expect(strapi.log.warn).not.toHaveBeenCalled();
  });
});

describe('the demoLineUserId warning', () => {
  it('warns when it is not a LINE user ID, without repeating the value', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() }, { liffUrl: LIFF, demoLineUserId: 'not-an-id-9f3' });

    expect(strapi.log.warn).toHaveBeenCalledOnce();
    const message = strapi.log.warn.mock.calls[0][0] as string;
    expect(message).toContain('demoLineUserId');
    expect(message).not.toContain('not-an-id-9f3');
  });

  it.each([['a LINE user ID', `U${'a'.repeat(32)}`], ['not set', null], ['empty', '']])('is quiet when it is %s', async (_what, value) => {
    const strapi = await bootstrapped({ sweep: vi.fn() }, { liffUrl: LIFF, demoLineUserId: value });

    expect(strapi.log.warn).not.toHaveBeenCalled();
  });

  it('gives both warnings when both settings are wrong', async () => {
    const strapi = await bootstrapped({ sweep: vi.fn() }, { demoLineUserId: 'nope' });

    expect(strapi.log.warn).toHaveBeenCalledTimes(2);
  });
});
