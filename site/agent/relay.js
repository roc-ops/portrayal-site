// site/agent/relay.js
// CONNECT YOUR AI (spec §4.3): the visitor's own desktop AI (Claude Desktop,
// Claude Code, Cursor) reaches this page's tools through MCP-B's local relay.
// Off by default: turning it on opens a socket to the visitor's machine, which
// Chrome asks about. Nothing from vendor/mcp-b/ loads until it is on.

import {modelContext, registerTools} from './webmcp.js';

const VERSION = '5.1.0';  // @mcp-b/webmcp-local-relay, as vendored (vendor/mcp-b/VERSION)
const SRC = {global: '/vendor/mcp-b/global.js', embed: '/vendor/mcp-b/embed.js'};
const INTEGRITY = {};  // set only for the jsDelivr fallback (none: self-hosted)
const RELAY_FRAME = 'iframe[data-webmcp-relay]';  // spec §6.1, spike findings
// The relay accepts one page origin, so the commands name THIS page's own: on
// portrayal.dev that is https://portrayal.dev, and a localhost or preview page
// tells its user the flag that page needs.
export const relayCommand = origin => `npx -y @mcp-b/webmcp-local-relay@${VERSION} --widget-origin ${origin}`;
export const relayConfig = origin => JSON.stringify({mcpServers: {portrayal: {command: 'npx',
  args: ['-y', `@mcp-b/webmcp-local-relay@${VERSION}`, '--widget-origin', origin]}}}, null, 2);
export const rejectedText = origin => `Your relay refused this page. Start it with --widget-origin ${origin}.`;

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
    // The widget scans 32 endpoints on its own, and after a failed pass Chromium
    // throttles new sockets from this page. So it never scans: Connect asks.
    if (src === SRC.embed) s.setAttribute('data-auto-connect', 'false');
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

// `onTools(registered)` hears when this switch has registered the tools (true)
// and when switching off took them back (false): the page's hint says so.
export function relaySwitch({mount, tools, native, examples, onTools = () => {}}) {
  let ac = null;
  const status = el('p', {className: 'rk-muted', role: 'status'});
  // Only a change is written: the region would announce a repeat again.
  const say = text => { if (status.textContent !== text) status.textContent = text; };
  const connect = el('button', {type: 'button', textContent: 'Connect', hidden: true});
  const relayBox = el('input', {type: 'checkbox', id: 'agentRelay', checked: prefs.relay});
  const markBox = el('input', {type: 'checkbox', id: 'agentMark', checked: prefs.highlight});

  // The relay frame says so when the relay refuses this page's origin. It
  // retries about twice a second, so the same text lands again and again.
  const onMessage = e => {
    if (e.origin !== location.origin) return;
    const frame = document.querySelector(RELAY_FRAME);
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'webmcp.tools.list.request') say('Found your relay.');
    if (e.data?.type === 'webmcp.relay.rejected') say(rejectedText(location.origin));
  };
  connect.addEventListener('click', () => {
    const win = document.querySelector(RELAY_FRAME)?.contentWindow;
    if (!win) { say('Still starting. Try again in a moment.'); return; }
    win.postMessage({type: 'webmcp.connect'}, location.origin);  // what embed.js sends when the tab returns
  });

  // Off means off: a switch-on still waiting on its scripts must not finish
  // after a switch-off (run counts both), and a frame embed.js inserts late,
  // after its fetch of widget.html, is removed while the switch is off.
  let run = 0;
  const reaper = new MutationObserver(() => { for (const f of document.querySelectorAll(RELAY_FRAME)) f.remove(); });

  async function on() {
    const mine = ++run;
    reaper.disconnect();
    connect.hidden = false;
    say('Starting…');
    window.addEventListener('message', onMessage);
    try {
      if (!modelContext()) await loadScript(SRC.global);
      if (run !== mine) return;
      await loadScript(SRC.embed);
      if (run !== mine) return;
      const own = modelContext();
      if (own && typeof own.executeTool !== 'function') {
        // The browser's own WebMCP: the relay can't run tools through it (R6).
        connect.hidden = true;
        say("Your browser has its own WebMCP, which the desktop relay can't read yet. Your browser's own assistant can still use this page.");
        return;
      }
      if (!(typeof native === 'function' ? await native() : native)) {
        const mineAc = new AbortController();
        ac = mineAc;
        const r = await registerTools(tools, {signal: mineAc.signal});
        if (run !== mine) { mineAc.abort(); return; }
        if (r?.registered > 0) onTools(true);
      }
      say('On. Start the relay on your computer first, then press Connect.');
    } catch (e) {
      if (run !== mine) return;
      console.warn('[portrayal] relay', e);
      say("Couldn't start the connection. Reload the page and try again.");
    }
  }
  function off() {
    run++;
    window.removeEventListener('message', onMessage);
    if (ac) onTools(false);
    ac?.abort(); ac = null;
    for (const f of document.querySelectorAll(RELAY_FRAME)) f.remove();
    reaper.observe(document.body, {childList: true});
    // Let a later switch-on run the embed again, since it builds the frame.
    if (loaded.delete(SRC.embed)) document.querySelector(`script[src="${SRC.embed}"]`)?.remove();
    connect.hidden = true;
    status.textContent = loaded.has(SRC.global) ? 'Off. A reload clears the last of it.' : 'Off.';
  }
  relayBox.addEventListener('change', () => { prefs.relay = relayBox.checked; (relayBox.checked ? on : off)(); });
  markBox.addEventListener('change', () => { prefs.highlight = markBox.checked; });

  mount.replaceChildren(
    el('label', {className: 'rk-agent-switch'}, relayBox, ' Let my desktop AI use this page'),
    status,
    connect,
    el('p', {textContent: 'Your AI runs on your computer and talks to this page directly. portrayal.dev sees nothing of it.'}),
    copyRow('Run on your computer', relayCommand(location.origin)),
    copyRow('Or add to Claude Desktop or Claude Code', relayConfig(location.origin)),
    el('p', {className: 'rk-muted', textContent: 'Try asking:'}),
    ...examples.map(x => copyRow('', x)),
    el('label', {className: 'rk-agent-switch'}, markBox, " Outline what my AI changes"),
  );
  if (relayBox.checked) on();
  return {dispose: off};
}
