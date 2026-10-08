// site/rack/agent-hint.js
// THE PAGE HINT (spec 2026-10-08 section 6): an agent that reads the page's DOM
// rather than WebMCP (Claude in Chrome) finds, first thing in the body, a JSON
// block and a one-line paragraph saying the page has tools and how to call
// them. In the first end-to-end run an agent clicked the rack until it was told
// the tools were there, so the hint comes before anything else on the page and
// is the body's accessible description.
//
// It never claims tools that are not there: the list is written only once the
// tools are registered (natively, or by Connect your AI); until then it says
// how to connect.

export const CONNECT = 'open the Connect your AI menu (#agentMenu) in the bar above the rack and tick "Let my desktop AI use this page"';
export const HOW_TO = "const mc = document.modelContext ?? navigator.modelContext; " +
  "const t = (await mc.getTools()).find(t => t.name === 'describe_rack'); await mc.executeTool(t, {}). " +
  "executeTool takes the tool object from getTools(), not its name. Results are {content: [{type: 'text', text}]}.";

// The paragraph, for tools registered (`names`) or not yet ([]).
export function hintText(names) {
  if (names.length)
    return 'This page has tools for AI agents: use them rather than clicking the page. ' +
      'Call document.modelContext.executeTool(tool, args), with the tool object from await document.modelContext.getTools(). ' +
      `The tools are: ${names.join(', ')}. Start with describe_rack.`;
  return 'This page has tools for AI agents, not yet registered in this browser: ' +
    `${CONNECT}, then call document.modelContext.executeTool(tool, args) with a tool from getTools(). ` +
    'The JSON block #webmcp-hint says how.';
}

// Writes both: the JSON block's `registered` and `tools`, and the paragraph.
export function writeHint(doc, names = []) {
  const el = doc?.getElementById?.('webmcp-hint');
  if (!el) return false;
  let hint;
  try { hint = JSON.parse(el.textContent); } catch { return false; }
  const list = [...names];
  el.textContent = JSON.stringify({...hint, registered: list.length > 0, tools: list,
    ...(list.length ? {connect: undefined} : {connect: `Not registered yet: ${CONNECT}.`})});
  const p = doc.getElementById?.('webmcp-hint-text');
  if (p) p.textContent = hintText(list);
  return true;
}
