// WEBMCP: hand a page's tools to whatever agent the browser offers them to.
// The API moved from navigator.modelContext to document.modelContext in 2026;
// Chromium 150 still serves the old one during the origin trial, so both are
// read. Shared by every page that offers tools (the Rack Builder first).

export const modelContext = () => globalThis.document?.modelContext ?? globalThis.navigator?.modelContext ?? null;

// Each tool is registered on its own: one the browser refuses is logged and
// skipped, and the rest still register. Aborting `signal` unregisters them all.
export async function registerTools(tools, {signal} = {}) {
  const mc = modelContext();
  if (!mc || typeof mc.registerTool !== 'function') return {registered: 0};
  let registered = 0;
  const errors = [];
  for (const t of tools) {
    try {
      await mc.registerTool(t, {signal});
      registered++;
    } catch (e) {
      console.warn('[portrayal] WebMCP: could not register', t.name, e);
      errors.push(`${t.name}: ${e.message}`);
    }
  }
  return errors.length ? {registered, error: errors.join('; ')} : {registered};
}
