import test from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../../site/rack/export-data.js';
import * as M from '../../site/rack/model.js';

const DAY = new Date(2026, 8, 27);
// check-browser.py's export fixture, with each item's height.
export const ITEMS = [
  {id: 'i1', ref: 'asr-9006', cfg: 'base', label: 'core-1', ru: 2, u: 10, face: 'front', turned: false},
  {id: 'i2', ref: 'as7726-32x', cfg: 'ac-f2b', label: 'leaf-1', ru: 14, u: 1, face: 'front', turned: false},
  {id: 'i3', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 14, u: 1, face: 'rear', turned: false},
  {id: 'i4', ref: 'tm-280', cfg: 'base', label: 'demarc', ru: 20, u: 1, face: 'rear', turned: false},
];

test('every export of a rack shares one file stem', () => {
  assert.equal(X.fileStem('Export test'), 'Export-test');
  assert.equal(X.fileStem(' Lab / rack #2 '), 'Lab-rack-2');
  assert.equal(X.fileStem(''), 'rack');
});

test('CSV cells are quoted only when they must be, RFC 4180 style', () => {
  assert.equal(X.csvCell('plain'), 'plain');
  assert.equal(X.csvCell('a,b'), '"a,b"');
  assert.equal(X.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(X.csvCell(' edge'), '" edge"');
  assert.equal(X.csvCell(null), '');
  assert.equal(X.csvCell(3), '3');
  assert.equal(X.toCsv(['a', 'b'], [{a: 1, b: 'x,y'}, {a: null, b: 'say "hi"'}]),
    'a,b\r\n1,"x,y"\r\n,"say ""hi"""\r\n');
  assert.equal(X.toCsv(['a'], [{a: 1}], ['First note', 'Second, with a comma']),
    'a\r\n1\r\n\r\nNotes\r\nFirst note\r\n"Second, with a comma"\r\n');
});

test('the title block names the rack, frame, depths, holes and date', () => {
  assert.deepEqual(X.titleLines(M.newRack({name: 'Lab'}), DAY), ['Lab',
    'Four-post frame, 42U, U1 at the bottom', 'Rail depth 740 mm · usable depth 1000 mm',
    'Square holes (cage nuts)', 'Drawn 2026-09-27 with the Portrayal Rack Builder']);
  const edge = M.withFrame(M.newRack({name: 'Edge', kind: 'two-post'}),
    {heightRU: 12, numbering: 'top-down', holes: {style: 'tapped', thread: '10-32'}});
  assert.deepEqual(X.titleLines(edge, DAY).slice(1, 4),
    ['Two-post frame, 12U, U1 at the top', 'Usable depth 1000 mm', 'Tapped holes, 10-32']);
  assert.equal(X.holesText({holes: {style: 'tapped', thread: null}}), 'Tapped holes, thread not stated');
});

test('wrapText breaks on words and never splits one', () => {
  assert.deepEqual(X.wrapText('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(X.wrapText('abcdefghijk x', 5), ['abcdefghijk', 'x']);
  assert.deepEqual(X.wrapText('', 5), []);
});

test('notes become an XML comment that cannot close itself early', () => {
  assert.equal(X.xmlComment([]), '');
  assert.equal(X.xmlComment(['a -- b', 'c']),
    '<!--\nNotes from the Portrayal Rack Builder:\n- a - b\n- c\n-->');
});

test('a face that is missing or refused a part says so', () => {
  assert.deepEqual(X.faceNotes({label: 'mystery', u: 20, pane: 'rear', panel: 'front', face: null}),
    ['mystery at U20: no front drawing, so the rear shows an outline.']);
  assert.deepEqual(X.faceNotes({label: 'core-1', u: 2, pane: 'front', panel: 'front',
    face: {seat: {applied: 1, refused: ['slot-1'], failed: ['slot-3', 'slot-4']}}}), [
    'core-1 at U2: slot-1 refused the part chosen and is shown empty.',
    "core-1 at U2: the part chosen for slot-3, slot-4 couldn't be loaded, so the drawing shows what the configuration seats there."]);
  assert.deepEqual(X.faceNotes({label: 'x', u: 1, pane: 'front', panel: 'front',
    face: {seat: {applied: 0, refused: [], failed: []}}}), []);
});

test('what no export shows yet is said, not dropped', () => {
  assert.deepEqual(X.rackNotes({zeroU: [], cables: []}), []);
  assert.deepEqual(X.rackNotes({zeroU: [{}], cables: [{}, {}]}),
    ['1 zero-U item is not in this export yet.', '2 cables are not in this export yet.']);
  assert.deepEqual(X.threeDNotes({items: [{label: 'leaf-1', fields: {'port-1-occupant': {label: 'LR4'}}},
                                          {label: 'core-1', fields: {}}]}),
    ['Optic labels and colors are not in the 3D model yet: leaf-1.']);
});

test('positions follow the frame numbering; draw.io counts from the top', () => {
  const f = M.normalizeFrame({heightRU: 24});
  assert.equal(X.positionOf(f, 2, 10), 2);
  assert.equal(X.positionOf({...f, numbering: 'top-down'}, 2, 10), 14);
  assert.equal(X.positionOf({...f, numbering: 'top-down'}, 20, 1), 5);
  assert.equal(X.drawioU(24, 2, 10), 14);
  assert.equal(X.drawioU(24, 24, 1), 1);
});

test('a cabinet draws what is mounted there and whatever is not hidden behind it', () => {
  const {front, rear, hidden} = X.perFaceItems(ITEMS);
  assert.deepEqual(front.map(i => i.id), ['i1', 'i2', 'i4']);
  assert.deepEqual(rear.map(i => i.id), ['i1', 'i3', 'i4']);
  assert.deepEqual(hidden.map(h => [h.pane, h.item.id, h.by.id]), [['front', 'i3', 'i2'], ['rear', 'i2', 'i3']]);
});
