import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Test-only: UNC installations may contain a copied workspace dependency.
// Verify the freshly built runtime without rewriting the installed snapshot.
// Node >= 22.19 (the runtime package's engine baseline). Use a native path
// for nextResolve so this also works for CommonJS require on Windows UNC.
const runtime = fileURLToPath(new URL('../packages/model-runtime/dist/index.js', import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@qitu/model-runtime') {
      return nextResolve(runtime, context);
    }
    return nextResolve(specifier, context);
  },
});
