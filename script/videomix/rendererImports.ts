// Lets dev scripts run the pure renderer modules (src/renderer/src/videomix/**) directly with Node's type stripping.
// Those modules use Vite-style extensionless relative imports (`./geometry`), which Node's ESM resolver rejects; this
// hook retries such specifiers with `.ts` / `.tsx` / `/index.ts`. It also defines Vite's `import.meta.env` (as a
// production build) in the modules that use it.
//
// Usage: call registerRendererImports() first, then load the renderer modules with a dynamic `await import()` (static
// imports are resolved before any code runs). Don't `import type` them from scripts: tsconfig.node.json (NodeNext) would
// type-check them and reject their extensionless imports, so scripts declare the few types they need locally.
import { registerHooks } from 'node:module';

const candidateSuffixes = ['.ts', '.tsx', '/index.ts'];

const viteEnv = JSON.stringify({ DEV: false, PROD: true, MODE: 'production', SSR: false, BASE_URL: '/' });

let registered = false;

export default function registerRendererImports() {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
        // CommonJS package subpaths without exports map (`lodash/omit`, used by the overlay modules)
        if (!isRelative && /^[\w@][^:]*\/[^.]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
        if (!isRelative || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
        for (const suffix of candidateSuffixes) {
          try {
            return nextResolve(`${specifier}${suffix}`, context);
          } catch {
            // try the next one
          }
        }
        throw err;
      }
    },
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.includes('/src/renderer/') || result.source == null) return result;
      const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
      if (!source.includes('import.meta.env')) return result;
      // on the first line, so that stack traces keep their line numbers
      return { ...result, source: `import.meta.env ??= ${viteEnv};${source}` };
    },
  });
}
