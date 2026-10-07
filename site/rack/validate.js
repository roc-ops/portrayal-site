// A SMALL JSON SCHEMA VALIDATOR, over the keywords the command arguments and
// the rack schema use and nothing more. No dependency: the kit ships without a
// build step, and a full validator would be most of its weight. Each error says
// where (a path of keys), which keyword refused, and the sub-schema that did,
// so a caller can turn it into a sentence.

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const IS = {
  null: v => v === null, boolean: v => typeof v === 'boolean', string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v),
  object: plain, array: Array.isArray,
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function deref(root, ref) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  const target = m && root.$defs?.[m[1]];
  if (!target) throw new Error(`validate: cannot follow ${ref}`);
  return target;
}

export function validate(schema, value, root = schema, path = []) {
  if (schema.$ref) return validate(deref(root, schema.$ref), value, root, path);
  const err = (keyword, at = path, extra = {}) => ({path: at, keyword, schema, ...extra});
  const types = schema.type == null ? null : [].concat(schema.type);
  if (types && !types.some(t => IS[t]?.(value))) return [err('type')];
  if ('const' in schema && !same(schema.const, value)) return [err('const')];
  if (schema.enum && !schema.enum.some(e => same(e, value))) return [err('enum')];
  const out = [];
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(err('minimum'));
    if (schema.maximum != null && value > schema.maximum) out.push(err('maximum'));
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) out.push(err('exclusiveMinimum'));
  }
  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) out.push(err('minLength'));
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(err('minItems'));
    if (schema.items) value.forEach((v, i) => out.push(...validate(schema.items, v, root, [...path, String(i)])));
  }
  if (plain(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(err('required', path, {missing: k}));
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) out.push(...validate(props[k], v, root, [...path, k]));
      else if (schema.additionalProperties === false) out.push(err('additionalProperties', [...path, k]));
      else if (plain(schema.additionalProperties)) out.push(...validate(schema.additionalProperties, v, root, [...path, k]));
    }
    for (const [k, needs] of Object.entries(schema.dependentRequired || {}))
      if (k in value) for (const n of needs) if (!(n in value)) out.push(err('dependentRequired', path, {missing: n}));
  }
  return out;
}
