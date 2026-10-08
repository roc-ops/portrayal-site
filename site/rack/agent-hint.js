// site/rack/agent-hint.js
// THE PAGE HINT (spec 2026-10-08 section 6): an agent that reads the page's DOM
// rather than WebMCP (Claude in Chrome) finds a JSON block in rack.html saying
// the tools exist and how to call them. The page writes the names in at boot,
// from the tools it registers, so the list can't drift.
export function writeHint(doc, names) {
  const el = doc?.getElementById?.('webmcp-hint');
  if (!el) return false;
  let hint;
  try { hint = JSON.parse(el.textContent); } catch { return false; }
  el.textContent = JSON.stringify({...hint, tools: [...names]});
  return true;
}
