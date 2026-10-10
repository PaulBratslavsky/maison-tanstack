import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { SUBJECT_A, bootStrapi } from './harness.mjs';

const INQUIRY = 'plugin::maison.inquiry';
/** A key for Ollama, which a hosted Ollama may want. It must never reach a log. */
const KEY = 'ollama-test-key-0123456789';
const LABELS = {
  kind: 'complaint',
  sentimentScore: -0.6,
  sentimentLabel: 'negative',
  answered: true,
  reason: 'The customer says the strap broke.',
  topic: 'repairs',
};
const FIRST = 'The strap on my bag broke after a week.';
const SECOND = 'The zip of my coffret broke on the first day.';

/**
 * A model on a free port of this machine, which answers Ollama's chat route as `behaviour` says: `labels` (the default),
 * `not-found` (a model it does not have, a 404), or `wrong-shape` (a sentiment score of 3, which no label allows). It keeps
 * every request, and `closeNow()` shuts the port, so the next request is refused. Nothing here reaches a model.
 */
const startModelStub = async () => {
  const requests = [];
  const state = { behaviour: 'labels' };
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(raw || 'null') });
      if (state.behaviour === 'not-found') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: "model 'stand-in' not found" }));
        return;
      }
      const labels = state.behaviour === 'wrong-shape' ? { ...LABELS, sentimentScore: 3 } : LABELS;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ model: 'stand-in', created_at: '2026-10-10T00:00:00Z', message: { role: 'assistant', content: JSON.stringify(labels) }, done: true, done_reason: 'stop' })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

describe('inquiry labelling, when the model fails', () => {
  let strapi;
  let model;
  let inquiries;
  let labelling;
  const warnings = [];

  const stored = (message) => strapi.documents(INQUIRY).findFirst({ filters: { message: { $eq: message } } });
  const logTurn = async (message) => {
    const result = await inquiries.log({ subject: SUBJECT_A, locale: 'en', message, reply: 'I am sorry to hear that.', knowledgeFound: false, handedOff: false });
    assert.deepEqual(result, { ok: true, value: { logged: true } });
  };
  const statesOf = async () => {
    const rows = [await stored(FIRST), await stored(SECOND)];
    return rows.map((row) => [row.analysisStatus, row.analysisAttempts]);
  };

  before(async () => {
    model = await startModelStub();
    strapi = await bootStrapi('labelling-failures', {
      maisonConfig: { aiProvider: 'ollama', aiModel: 'stand-in', aiBaseUrl: model.url, aiApiKey: KEY },
    });
    inquiries = strapi.plugin('maison').service('inquiries');
    labelling = strapi.plugin('maison').service('labelling');
    // Keeps what the sweep warns, as well as writing it.
    const warn = strapi.log.warn.bind(strapi.log);
    strapi.log.warn = (...args) => {
      warnings.push(args.map(String).join(' '));
      return warn(...args);
    };
    await logTurn(FIRST);
    await logTurn(SECOND);
  });

  after(async () => {
    await strapi?.destroy();
    await model?.close().catch(() => undefined);
  });

  it('leaves both rows as they were, and warns once, when the model is not found: a wrong AI_MODEL parks nothing', async () => {
    model.state.behaviour = 'not-found';

    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 0 });

    assert.deepEqual(await statesOf(), [['pending', 0], ['pending', 0]]);
    assert.equal(model.requests.length, 1, 'the second row is not tried in the same sweep');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\[maison\] Labelling stopped until the next sweep\. The AI provider refused the key or the setup: .*model 'stand-in' not found/);
  });

  it('sends the key as a bearer token, and no warning carries it', async () => {
    assert.equal(model.requests[0].authorization, `Bearer ${KEY}`);
    assert.equal(warnings.join('\n').includes(KEY), false);
  });

  it('counts an answer in the wrong shape against each row, and goes on to the next row', async () => {
    model.state.behaviour = 'wrong-shape';
    warnings.length = 0;

    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 2, skipped: 0 });

    assert.deepEqual(await statesOf(), [['failed', 1], ['failed', 1]]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /Labelling inquiry .* failed \(attempt 1 of 5\): Validation failed/);
    assert.equal((await stored(FIRST)).kind ?? null, null, 'none of a wrong answer reaches the row');
  });

  it('labels the failed rows once the model answers well, and keeps the attempts they had', async () => {
    model.state.behaviour = 'labels';

    assert.deepEqual(await labelling.sweep(), { labelled: 2, failed: 0, skipped: 0 });

    for (const message of [FIRST, SECOND]) {
      const row = await stored(message);
      assert.equal(row.analysisStatus, 'analyzed', message);
      assert.equal(row.analysisAttempts, 1, message);
      assert.equal(row.kind, 'complaint', message);
      assert.equal(row.modelVersion, 'ollama/stand-in', message);
    }
  });

  it('leaves a new row as it was, and warns once, when Ollama is not running: the port refuses the connection', async () => {
    await logTurn('The clasp of my trunk broke on the first day.');
    await model.close();
    warnings.length = 0;

    assert.deepEqual(await labelling.sweep(), { labelled: 0, failed: 0, skipped: 0 });

    const clasp = await stored('The clasp of my trunk broke on the first day.');
    assert.equal(clasp.analysisStatus, 'pending');
    assert.equal(clasp.analysisAttempts, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\[maison\] Labelling stopped until the next sweep\. The AI provider gave no answer: .*fetch failed/);
    assert.equal(warnings[0].includes(KEY), false);
  });
});
