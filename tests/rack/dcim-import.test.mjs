import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../../site/rack/dcim-rules.js';

// The vendored type files, read as text - what the page fetches.
const EXPORTS = new URL('../../assets/exports/', import.meta.url);
const yaml = path => fs.readFileSync(new URL(path, EXPORTS), 'utf8');
const lists = path => D.typeLists(yaml(path));
const ASR = 'netbox/device-types/Cisco/ASR-9006-AC-V2.yaml', LEAF = 'netbox/device-types/Edgecore/7726-32X-O-AC-F.yaml',
  TM = 'netbox/device-types/Telco Systems/TM-280.yaml', CARD = 'netbox/module-types/Cisco/A9K-16X100GE-TR.yaml';

test('a type file gives its own name lists, by section, and its bays by name and position', () => {
  const tm = lists(TM);
  assert.equal(tm.manufacturer, 'Telco Systems');
  assert.equal(tm.model, 'TM-280');
  assert.deepEqual(tm.sections.interfaces, ['port-1-1', 'port-2-1', 'port-3-1', 'copper-3-1', 'port-2-2']);
  assert.deepEqual(tm.sections['console-ports'], ['Console']);
  assert.deepEqual(tm.sections['power-ports'], ['dc-in']);
  assert.deepEqual(tm.bays, []);
  const asr = lists(ASR);
  assert.deepEqual(asr.sections.interfaces, []);
  assert.deepEqual(asr.bays.find(b => b.position === 'slot-2'), {name: 'slot-2', position: 'slot-2'});
  assert.equal(asr.bays.length, 11);
  // A quoted name is read without its quotes; a name is not a path until a bay's position replaces {module}.
  assert.deepEqual(lists(CARD).sections.interfaces.slice(0, 2), ['{module}/p0', '{module}/p1']);
  // A bay's name is for display; its position is the drawing's bay id.
  assert.deepEqual(lists(LEAF).bays[0], {name: 'Fan 1', position: 'fan-1'});
  assert.deepEqual(D.bayAt(lists('netbox/device-types/Casa Systems/C40G-CHASSIS-AC.yaml'), 'front-0'),
    {name: 'Front 0', position: 'front-0'});
  assert.equal(D.bayAt(lists(LEAF), 'Fan 1'), null);
  // Not a type file at all: empty lists, never a throw.
  assert.deepEqual(D.typeLists('').sections.interfaces, []);
  assert.deepEqual(D.typeLists(undefined).bays, []);
});

test('the NetBox and Nautobot copies of the fixture types name the same things', () => {
  for (const p of [ASR, LEAF, TM, CARD]) {
    const nb = lists(p), nt = lists(p.replace(/^netbox\//, 'nautobot/'));
    assert.deepEqual(nt.sections, nb.sections, p);
    assert.deepEqual(nt.bays, nb.bays, p);
  }
});

test("the fixture's cable ends resolve to the names the real instances made", () => {
  const leaf = lists(LEAF), asr = lists(ASR), tm = lists(TM), card = lists(CARD);
  for (const path of ['port-1', 'port-2', 'mgmt-eth'])
    assert.deepEqual(D.resolveEnd({path, device: leaf}), {ok: true, name: path, type: 'dcim.interface'});
  assert.deepEqual(D.resolveEnd({path: 'port-2-1', device: tm}), {ok: true, name: 'port-2-1', type: 'dcim.interface'});
  // result.json, inventory_after_modules: the card in slot-2 gave core-1 the interfaces slot-2/p0 to slot-2/p15.
  assert.deepEqual(D.resolveEnd({path: 'slot-2/module/p0', device: asr, moduleAt: bay => (bay === 'slot-2' ? card : null)}),
    {ok: true, name: 'slot-2/p0', type: 'dcim.interface', bay: {name: 'slot-2', position: 'slot-2'}});
  assert.deepEqual(D.resolveEnd({path: 'dc-in', device: tm}), {ok: true, name: 'dc-in', type: 'dcim.powerport'});
});

test('a console port is found by its own list, never by its path alone', () => {
  const tm = lists(TM);
  // The drawing calls it "con"; the type file calls its only console port "Console".
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con']}),
    {ok: true, name: 'Console', type: 'dcim.consoleport'});
  // Two drawn, one listed: which one is it? Not said.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm, consoles: ['con', 'con-usb']}),
    {ok: false, reason: 'the device type TM-280 does not say which of its console ports con is'});
  // Not drawn as a console at all: it is just a path the file does not list.
  assert.deepEqual(D.resolveEnd({path: 'con', device: tm}),
    {ok: false, reason: 'the device type TM-280 lists no port named con'});
  // "Console (<path>)" names it exactly.
  const two = D.typeLists('model: X\nconsole-ports:\n  - name: Console (usb)\n  - name: Console (rj45)\n');
  assert.deepEqual(D.resolveEnd({path: 'usb', device: two, consoles: ['usb', 'rj45']}),
    {ok: true, name: 'Console (usb)', type: 'dcim.consoleport'});
});

test('an end that does not resolve says why, and gets no name', () => {
  const asr = lists(ASR), card = lists(CARD), leaf = lists(LEAF);
  const why = arg => { const r = D.resolveEnd(arg); assert.equal(r.ok, false); assert.equal('name' in r, false); return r.reason; };
  assert.equal(why({path: 'port-1', device: null}), 'its device has no device type');
  assert.equal(why({path: 'port-99', device: leaf}), 'the device type 7726-32X-O-AC-F lists no port named port-99');
  assert.equal(why({path: 'slot-9/module/p0', device: asr, moduleAt: () => card}),
    'the device type ASR-9006-AC-V2 has no module bay at position slot-9');
  assert.equal(why({path: 'slot-2/module/p0', device: asr}), 'what is seated in slot-2 has no module type');
  assert.equal(why({path: 'slot-2/module/p99', device: asr, moduleAt: () => card}),
    'the module type A9K-16X100GE-TR lists no port named {module}/p99');
  assert.equal(why({path: 'slot-2/module/mic-0/module/p0', device: asr, moduleAt: () => card}),
    'it is a port of a module inside a card, and the card has no module bay to import that module into');
  // The Edgecore AS7326-56X draws port-57 where its type file lists "57": no convention bridges that.
  assert.equal(why({path: 'port-57', device: lists('netbox/device-types/Edgecore/7326-56X-O-48V-B.yaml')}),
    'the device type 7326-56X-O-48V-B lists no port named port-57');
});

test('the list a name is in gives the end its type: a cassette has front and rear ports, not interfaces', () => {
  const cassette = lists('netbox/module-types/FS.com/FHD-1MTP6LCDOS2A.yaml');
  const dev = D.typeLists('model: Panel\nmodule-bays:\n  - name: Bay 1\n    position: bay-1\n');
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/1', type: 'dcim.frontport', bay: {name: 'Bay 1', position: 'bay-1'}});
  assert.deepEqual(D.resolveEnd({path: 'bay-1/module/MTP-1', device: dev, moduleAt: () => cassette}),
    {ok: true, name: 'bay-1/MTP-1', type: 'dcim.rearport', bay: {name: 'Bay 1', position: 'bay-1'}});
  // The drawing's own name for that adapter is lc1, which the file does not list.
  assert.equal(D.resolveEnd({path: 'bay-1/module/lc1', device: dev, moduleAt: () => cassette}).reason,
    'the module type FHD-1MTP6LCDOS2A lists no port named {module}/lc1');
});

test('every vendored type file is read whole: each "- name:" line is a name, a module port carries {module}/ once', () => {
  const files = JSON.parse(yaml('files.json'));
  let n = 0;
  for (const target of ['netbox', 'nautobot']) for (const path of files[target]) {
    const text = yaml(path), l = D.typeLists(text);
    const named = Object.values(l.sections).reduce((s, v) => s + v.length, 0) + l.bays.length;
    assert.equal(named, text.split('\n').filter(x => x.startsWith('  - name:')).length, path);
    assert.ok(l.model, path);
    assert.equal(new Set(l.bays.map(b => b.position)).size, l.bays.length, `${path}: two bays share a position`);
    if (path.includes('/module-types/'))
      for (const name of Object.values(l.sections).flat())
        assert.ok(name.startsWith('{module}/') && name.indexOf('{module}', 1) < 0, `${path}: ${name}`);
    n++;
  }
  assert.ok(n > 2000, `${n} files`);
});
