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
// How a call is made, as the page's WebMCP takes it: the MCP-B polyfill that
// Connect your AI loads (vendor/mcp-b/global.js), like Chromium's own testing
// call, takes the tool OBJECT from getTools() and its arguments as a JSON
// STRING, and answers with a JSON string. An object argument is refused
// ("Failed to parse input arguments"). HOW_TO is a snippet that runs as written
// (check-browser.py runs it against the vendored polyfill).
export const HOW_TO = "const mc = document.modelContext ?? navigator.modelContext; " +
  "const t = (await mc.getTools()).find(t => t.name === 'describe_rack'); " +
  "const result = JSON.parse(await mc.executeTool(t, JSON.stringify({}))); result.content[0].text";
export const CALLING = 'executeTool takes the tool object from getTools(), not its name, and the arguments as a JSON string ' +
  "(JSON.stringify(args)); it answers with a JSON string: JSON.parse it to get {content: [{type: 'text', text}], isError?}.";
const CALL = 'await document.modelContext.executeTool(tool, JSON.stringify(args))';

// The paragraph, for tools registered (`names`) or not yet ([]).
export function hintText(names) {
  if (names.length)
    return 'This page has tools for AI agents: use them rather than clicking the page. ' +
      `Call ${CALL}, with the tool object from await document.modelContext.getTools(); ` +
      'it answers with a JSON string, which JSON.parse turns into {content: [...]}. ' +
      `The tools are: ${names.join(', ')}. Start with describe_rack.`;
  return 'This page has tools for AI agents, not yet registered in this browser: ' +
    `${CONNECT}, then call ${CALL} with a tool from getTools(), and JSON.parse the string it answers. ` +
    'The JSON block #webmcp-hint has a snippet that runs as written.';
}

// Writes both: the JSON block's `registered` and `tools`, and the paragraph.
export function writeHint(doc, names = []) {
  const el = doc?.getElementById?.('webmcp-hint');
  if (!el) return false;
  let hint;
  try { hint = JSON.parse(el.textContent); } catch { return false; }
  const list = [...names];
  el.textContent = JSON.stringify({...hint, howTo: HOW_TO, calling: CALLING, registered: list.length > 0, tools: list,
    ...(list.length ? {connect: undefined} : {connect: `Not registered yet: ${CONNECT}.`})});
  const p = doc.getElementById?.('webmcp-hint-text');
  if (p) p.textContent = hintText(list);
  return true;
}
