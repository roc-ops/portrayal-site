import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../../site/rack/validate.js';

const S = {type: 'object', required: ['ru', 'face'], additionalProperties: false,
  properties: {ru: {type: 'integer', minimum: 1}, face: {enum: ['front', 'rear']},
               label: {type: 'string', minLength: 1}, length: {type: ['object', 'null'],
               properties: {value: {type: 'number', exclusiveMinimum: 0}}, required: ['value']},
               list: {type: 'array', minItems: 1, items: {type: 'string'}}},
  dependentRequired: {on: ['unit']}};

test('a valid value has no errors', () => {
  assert.deepEqual(validate(S, {ru: 3, face: 'rear', length: null, list: ['a']}), []);
});

test('required, type, enum and additionalProperties each name their path', () => {
  const kinds = e => e.map(x => [x.keyword, x.path.join('.'), x.missing ?? null]);
  assert.deepEqual(kinds(validate(S, {face: 'side'})), [['required', '', 'ru'], ['enum', 'face', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1.5, face: 'front'})), [['type', 'ru', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 0, face: 'front'})), [['minimum', 'ru', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', x: 1})), [['additionalProperties', 'x', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', length: {value: 0}})), [['exclusiveMinimum', 'length.value', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', list: []})), [['minItems', 'list', null]]);
  assert.deepEqual(kinds(validate(S, {ru: 1, face: 'front', list: [3]})), [['type', 'list.0', null]]);
});

test('dependentRequired, const and $ref', () => {
  const D = {$defs: {end: {type: 'object', required: ['item']}}, type: 'object',
             properties: {a: {$ref: '#/$defs/end'}, f: {const: 'portrayal-rack'}}, dependentRequired: {on: ['unit']}};
  assert.deepEqual(validate(D, {on: 'i1'}).map(e => [e.keyword, e.missing]), [['dependentRequired', 'unit']]);
  assert.deepEqual(validate(D, {f: 'x'}).map(e => e.keyword), ['const']);
  assert.deepEqual(validate(D, {a: {}}).map(e => [e.keyword, e.path.join('.'), e.missing]), [['required', 'a', 'item']]);
});

test('integer is not number-with-a-fraction, and null is only null', () => {
  assert.deepEqual(validate({type: 'integer'}, 2), []);
  assert.equal(validate({type: 'integer'}, '2').length, 1);
  assert.equal(validate({type: 'object'}, null).length, 1);
  assert.equal(validate({type: 'object'}, []).length, 1);
});
