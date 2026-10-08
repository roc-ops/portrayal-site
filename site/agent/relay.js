// site/agent/relay.js
// CONNECT YOUR AI (spec §4.3): the visitor's own desktop AI (Claude Desktop,
// Claude Code, Cursor) reaches this page's tools through MCP-B's local relay.
// Off by default: turning it on opens a socket to the visitor's machine, which
// Chrome asks about. Nothing from vendor/mcp-b/ loads until it is on.

import {modelContext, registerTools} from './webmcp.js';

const VERSION = '5.1.0';  // @mcp-b/webmcp-local-relay, as vendored (vendor/mcp-b/VERSION)
const SRC = {global: '/vendor/mcp-b/global.js', embed: '/vendor/mcp-b/embed.js'};
const INTEGRITY = {};  // set only for the jsDelivr fallback (none: self-hosted)
const RELAY_FRAME = 'iframe[data-webmcp-relay]';  // Spike findings
const COMMAND = `npx -y @mcp-b/webmcp-local-relay@${VERSION} --widget-origin https://portrayal.dev`;
const CONFIG = JSON.stringify({mcpServers: {portrayal: {command: 'npx',
  args: ['-y', `@mcp-b/webmcp-local-relay@${VERSION}`, '--widget-origin', 'https://portrayal.dev']}}}, null, 2);

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: not remembered */ } },
};
export const prefs = {
  get relay() { return store.get('portrayal.agent.relay') === 'on'; },
  set relay(v) { store.set('portrayal.agent.relay', v ? 'on' : 'off'); },
  get highlight() { return store.get('portrayal.agent.highlight') !== 'off'; },
  set highlight(v) { store.set('portrayal.agent.highlight', v ? 'on' : 'off'); },
};

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) loaded.set(src, new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), {src, async: false});
    if (INTEGRITY[src]) { s.integrity = INTEGRITY[src]; s.crossOrigin = 'anonymous'; }
    s.onload = resolve; s.onerror = () => { loaded.delete(src); reject(new Error(`Could not load ${src}`)); };
    document.head.append(s);
  }));
  return loaded.get(src);
}

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const copyRow = (label, text) => {
  const code = el('code', {textContent: text});
  const btn = el('button', {type: 'button', textContent: 'Copy'});
  btn.addEventListener('click', () => navigator.clipboard?.writeText(text).then(() => { btn.textContent = 'Copied'; }, () => {}));
  return el('div', {className: 'rk-agent-copy'}, el('span', {className: 'rk-muted', textContent: label}), code, btn);
};

export function relaySwitch({mount, tools, native, examples}) {
  let ac = null;
  const status = el('p', {className: 'rk-muted', role: 'status'});
  const relayBox = el('input', {type: 'checkbox', id: 'agentRelay', checked: prefs.relay});
  const markBox = el('input', {type: 'checkbox', id: 'agentMark', checked: prefs.highlight});

  // The relay frame says so when the relay refuses this page's origin. It
  // retries about twice a second, so the same text lands again and again.
  const onMessage = e => {
    if (e.origin !== location.origin) return;
    const frame = document.querySelector(RELAY_FRAME);
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'webmcp.relay.rejected') {
      status.textContent = 'Your relay refused this page. Start it with --widget-origin https://portrayal.dev.';
    }
  };

  async function on() {
    status.textContent = 'Starting…';
    window.addEventListener('message', onMessage);
    try {
      if (!modelContext()) await loadScript(SRC.global);
      await loadScript(SRC.embed);
      if (!native) {
        ac = new AbortController();
        await registerTools(tools, {signal: ac.signal});
      }
      status.textContent = 'On. Start the relay on your computer, then ask your AI to use this rack.';
    } catch (e) {
      console.warn('[portrayal] relay', e);
      status.textContent = "Couldn't start the connection. Reload the page and try again.";
    }
  }
  function off() {
    window.removeEventListener('message', onMessage);
    ac?.abort(); ac = null;
    for (const f of document.querySelectorAll(RELAY_FRAME)) f.remove();
    // Let a later switch-on run the embed again, since it builds the frame.
    if (loaded.delete(SRC.embed)) document.querySelector(`script[src="${SRC.embed}"]`)?.remove();
    status.textContent = loaded.has(SRC.global) ? 'Off. A reload clears the last of it.' : 'Off.';
  }
  relayBox.addEventListener('change', () => { prefs.relay = relayBox.checked; (relayBox.checked ? on : off)(); });
  markBox.addEventListener('change', () => { prefs.highlight = markBox.checked; });

  mount.replaceChildren(
    el('label', {className: 'rk-agent-switch'}, relayBox, ' Let my desktop AI use this page'),
    status,
    el('p', {textContent: 'Your AI runs on your computer and talks to this page directly. portrayal.dev sees nothing of it.'}),
    copyRow('Run on your computer', COMMAND),
    copyRow('Or add to Claude Desktop or Claude Code', CONFIG),
    el('p', {className: 'rk-muted', textContent: 'Try asking:'}),
    ...examples.map(x => copyRow('', x)),
    el('label', {className: 'rk-agent-switch'}, markBox, " Outline what my AI changes"),
  );
  if (relayBox.checked) on();
  return {dispose: off};
}
