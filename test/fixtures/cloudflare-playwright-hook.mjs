// Module hook: resolve @cloudflare/playwright to the local fake.
export async function resolve(specifier, context, next) {
  if (specifier === '@cloudflare/playwright') return { url: new URL('./fake-cloudflare-playwright.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
