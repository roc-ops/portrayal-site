// tests/agent/relay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {relayCommand, relayConfig, rejectedText} from '../../site/agent/relay.js';

test('the relay commands and the refusal name the page\'s own origin, not a fixed one', () => {
  for (const origin of ['https://portrayal.dev', 'http://localhost:8932', 'https://preview-12.example.pages.dev']) {
    assert.match(relayCommand(origin), new RegExp(`--widget-origin ${origin.replace(/[.:/]/g, '\\$&')}$`));
    const cfg = JSON.parse(relayConfig(origin));
    assert.deepEqual(cfg.mcpServers.portrayal.args.slice(-2), ['--widget-origin', origin]);
    assert.equal(rejectedText(origin), `Your relay refused this page. Start it with --widget-origin ${origin}.`);
  }
  assert.doesNotMatch(relayCommand('http://localhost:8932'), /portrayal\.dev/);
});
