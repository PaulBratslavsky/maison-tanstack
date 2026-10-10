import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../server/src/', import.meta.url));

/** Every file under server/src, as a path from it. */
const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.relative(root, path.join(directory, entry.name))]
  );

/** An import, a dynamic import, a require, or a bare import of an @tanstack package, with either kind of quote. */
const NAMES_TANSTACK = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']@tanstack\//;

describe('the @tanstack packages', () => {
  const files = filesUnder(root).filter((file) => /\.(ts|tsx|js|mjs|cjs)$/.test(file));

  it('finds the server files', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain(path.join('ai', 'sdk.ts'));
  });

  it('are named by ai/sdk.ts alone: they ship ESM only, and one file loads them with import()', () => {
    const naming = files.filter((file) => NAMES_TANSTACK.test(readFileSync(path.join(root, file), 'utf8')));
    expect(naming).toEqual([path.join('ai', 'sdk.ts')]);
  });

  it('are loaded by sdk.ts with import(), and never with require or a static import', () => {
    const source = readFileSync(path.join(root, 'ai', 'sdk.ts'), 'utf8');
    expect(source).toMatch(/await import\('@tanstack\/ai'\)/);
    expect(source).toMatch(/await import\('@tanstack\/ai-anthropic'\)/);
    expect(source).toMatch(/await import\('@tanstack\/ai-ollama'\)/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    // Every static import is a type, which the build erases.
    const staticImports = [...source.matchAll(/^import\s+[^;]*from\s+'@tanstack\/[^']+';/gm)].map((match) => match[0]);
    expect(staticImports.length).toBeGreaterThan(0);
    for (const line of staticImports) expect(line).toMatch(/^import type /);
  });

  it('are not loaded by any file that imports sdk.ts at boot: sdk.ts holds no top-level await of them', () => {
    const source = readFileSync(path.join(root, 'ai', 'sdk.ts'), 'utf8');
    // Each import() sits inside a function, so reading the file loads nothing. A top-level line would start at column 0.
    expect(source).not.toMatch(/^(?:const|let|var)\s.*=\s*await import\(/m);
    expect(source).not.toMatch(/^await import\(/m);
  });
});

describe('the Vercel AI SDK', () => {
  const files = filesUnder(root).filter((file) => /\.(ts|tsx|js|mjs|cjs)$/.test(file));

  it('is named by no server file', () => {
    const naming = files.filter((file) => /["'](?:ai|@ai-sdk\/[^"']+)["']/.test(readFileSync(path.join(root, file), 'utf8')));
    expect(naming).toEqual([]);
  });
});

describe('scripts/check-esm-import.mjs', () => {
  const script = fileURLToPath(new URL('../../scripts/check-esm-import.mjs', import.meta.url));

  /** A folder holding index.js and index.mjs with these sources, checked by the script. */
  const check = (sources: { js?: string; mjs?: string }) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'maison-bundle-'));
    try {
      if (sources.js !== undefined) writeFileSync(path.join(folder, 'index.js'), sources.js);
      if (sources.mjs !== undefined) writeFileSync(path.join(folder, 'index.mjs'), sources.mjs);
      const result = spawnSync(process.execPath, [script, folder], { encoding: 'utf8' });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  };

  const LOADS_DYNAMICALLY =
    'async function load() {\n  sdk = await import("@tanstack/ai");\n  adapter = await import("@tanstack/ai-anthropic");\n  local = await import("@tanstack/ai-ollama");\n}\n';

  it('passes a bundle that loads the packages only with import(), and counts the sites', () => {
    const result = check({ js: LOADS_DYNAMICALLY, mjs: LOADS_DYNAMICALLY });
    expect(result.status).toBe(0);
    expect(result.output).toContain('index.js: no static load of @tanstack/ai (3 dynamic import sites)');
    expect(result.output).toContain('index.mjs: no static load of @tanstack/ai (3 dynamic import sites)');
  });

  it.each([
    ['a require of the SDK', 'const ai = require("@tanstack/ai");\n'],
    ['a require of the Anthropic adapter', "const anthropic = require('@tanstack/ai-anthropic');\n"],
    ['a require of the Ollama adapter', "const ollama = require('@tanstack/ai-ollama');\n"],
    ['an import with bindings', 'import { chat } from "@tanstack/ai";\n'],
    ['an import over several lines', 'import {\n  chat,\n  toolDefinition\n} from "@tanstack/ai";\n'],
    ['a bare import, which still loads the module', 'import "@tanstack/ai-anthropic";\n'],
    ['a minified import with no spaces', 'import{chat}from"@tanstack/ai";\n'],
    ['a minified default import', 'import chat from"@tanstack/ai";\n'],
    ['a minified namespace import', 'import*as ai from"@tanstack/ai";\n'],
    ['a minified bare import', 'import"@tanstack/ai-ollama";\n'],
    ['an import after other code on the same line', 'var a=1;import{b}from"@tanstack/ai-anthropic";var c=2;\n'],
    ['a re-export of names', 'export { chat } from "@tanstack/ai";\n'],
    ['a re-export of everything', 'export * from "@tanstack/ai-anthropic";\n'],
    ['a minified re-export of everything', 'export*from"@tanstack/ai";\n'],
    ['a minified re-export of names', 'export{chat as c}from"@tanstack/ai-ollama";\n'],
    ['a re-export as a namespace', 'export * as ai from "@tanstack/ai";\n'],
    ['a re-export over several lines', 'export {\n  chat,\n  toolDefinition\n} from "@tanstack/ai";\n'],
    ['a minified require', 'const a=require("@tanstack/ai");\n'],
    ['a require with spaces and a template string', 'const a = require( `@tanstack/ai` );\n'],
  ])('fails a bundle with %s, and names the package', (_what, line) => {
    for (const sources of [
      { js: `${LOADS_DYNAMICALLY}${line}`, mjs: LOADS_DYNAMICALLY },
      { js: LOADS_DYNAMICALLY, mjs: `${line}${LOADS_DYNAMICALLY}` },
    ]) {
      const result = check(sources);
      expect(result.status).toBe(1);
      expect(result.output).toMatch(/loads the SDK statically: @tanstack\/ai/);
    }
  });

  it('passes a minified bundle that loads the packages only with import(), and counts the sites', () => {
    const minified = 'async function a(){return await import("@tanstack/ai")}async function b(){return import("@tanstack/ai-anthropic")}export{a,b};\n';
    const result = check({ js: minified, mjs: minified });
    expect(result.status).toBe(0);
    expect(result.output).toContain('index.js: no static load of @tanstack/ai (2 dynamic import sites)');
  });

  it('passes a bundle that exports without naming the packages, and one that imports other packages', () => {
    const other = 'import{a}from"node:path";export{a};export*from"./other.js";export{b}from"@tanstack/virtual-core";\n';
    expect(check({ js: other, mjs: other }).status).toBe(0);
  });

  describe('run against a small bundle on disk', () => {
    const fixtures = fileURLToPath(new URL('../fixtures/esm-guard/', import.meta.url));
    const run = (name: string) => spawnSync(process.execPath, [script, path.join(fixtures, name)], { encoding: 'utf8' });

    it('exits non-zero for a bundle with a static import, and names the package', () => {
      const result = run('static');
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/loads the SDK statically: @tanstack\/ai/);
    });

    it('exits zero for a bundle with a dynamic import only', () => {
      const result = run('dynamic');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no static load of @tanstack/ai (1 dynamic import site)');
    });
  });

  it('fails when a bundle is missing, and says to build first', () => {
    const result = check({ js: LOADS_DYNAMICALLY });
    expect(result.status).toBe(1);
    expect(result.output).toContain('index.mjs is missing: run npm run build first');
  });

  it("ignores other @tanstack packages: only the AI packages are the plugin's concern", () => {
    const result = check({
      js: 'const x = require("@tanstack/react-virtual");\nimport { y } from "@tanstack/virtual-core";\n',
      mjs: LOADS_DYNAMICALLY,
    });
    expect(result.status).toBe(0);
  });
});
