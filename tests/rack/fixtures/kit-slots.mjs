// tests/rack/fixtures/kit-slots.mjs
// THE TEST DEVICES for the rack agent tools: their sizes as the catalog gives
// them (with `kind`), and their parts lists in the shape the kit's loadSlots
// answers (rack-agent-commands-design.md section 4). Every device here has a
// parts list: the kit refuses a command on a device whose list is null.

export const SIZES = {
  'as7726-32x': {ru: 1, h: 43.5, d: 515, model: 'AS7726-32X', manufacturer: 'Accton', configs: ['ac-f2b'], default: 'ac-f2b', family: null, kind: 'switch'},
  'r740xd': {ru: 2, h: 86.8, d: 737.5, model: 'R740xd', manufacturer: 'Dell', configs: ['a', 'b'], default: 'a', family: 'poweredge', kind: 'server'},
  'fhd-1ufce': {ru: 1, h: 44, d: 432.8, model: 'FHD-1UFCE', manufacturer: 'FS.com', configs: ['base', 'panels'], default: 'base', family: null, kind: 'patch panel'},
  'leaf-56': {ru: 1, h: 43.5, d: 500, model: 'LEAF-56', manufacturer: 'Test', configs: ['base'], default: 'base', family: null, kind: 'switch'},
};
export const chassisOf = ref => SIZES[ref] || null;

const QSFP = ['generic/qsfp-lc@2', 'generic/qsfp-dac@1'];
const QSFP7 = ['generic/qsfp-lc@2', 'generic/qsfp-dac@1', 'generic/qsfp-sr4@1', 'generic/qsfp-lr4@1',
               'generic/qsfp-cwdm4@1', 'generic/qsfp-aoc@1', 'generic/qsfp-er4@1'];
const SFP = ['generic/sfp-sr@1', 'generic/sfp-lr@1'];
const FHD = ['fs/fhd-fap12lcd-os2@1', 'fs/fhd-fap6scd-os2@1'];
const cage = (n, iface, accepts) => ({id: `port-${n}`, interface: iface, accepts, default: null});
const none = {front: [], rear: []};
const cfg = (name, description, bays = {}) => ({name, description, airflow: null, bays, occupants: {}});

export const SLOTS = {
  'as7726-32x': {
    bays: {front: [], rear: [{id: 'psu-1', group: 'psu', accepts: ['common/psu-ac-650@2', 'common/psu-dc-650@2'], default: 'common/psu-ac-650@2'}]},
    cages: {front: Array.from({length: 32}, (_, i) => cage(i + 1, 'qsfp28', QSFP)), rear: []},
    configs: [{...cfg('ac-f2b', 'AC power, front-to-back air.'), airflow: 'f2b'}], default: 'ac-f2b'},
  'r740xd': {bays: none, cages: none, configs: [cfg('a', 'Config a.'), cfg('b', 'Config b.')], default: 'a'},
  'fhd-1ufce': {
    bays: {front: [1, 2, 3, 4].map(n => ({id: `bay-${n}`, group: 'slots', accepts: FHD, default: null})), rear: []},
    cages: none,
    configs: [cfg('base', 'An empty tray.'), cfg('panels', 'Four adapter panels.', {'bay-1': 'fs/fhd-fap12lcd-os2@1'})], default: 'base'},
  'leaf-56': {
    bays: none,
    cages: {front: [...Array.from({length: 48}, (_, i) => cage(i + 1, 'sfp28', SFP)),
                    ...Array.from({length: 8}, (_, i) => cage(i + 49, 'qsfp28', QSFP7))], rear: []},
    configs: [cfg('base', 'Forty-eight 25G ports and eight 100G uplinks.')], default: 'base'},
};
const optic = {kind: 'component', fields: {label: {type: 'text', default: ''}, 'latch-color': {type: 'text', default: '#6f6f6f'}}};
export const COMPONENTS = {
  ...Object.fromEntries([...QSFP7, ...SFP].map(r => [r, optic])),
  'generic/qsfp-dac@1': {kind: 'component', fields: {}},
  'common/psu-ac-650@2': {kind: 'component', fields: {}}, 'common/psu-dc-650@2': {kind: 'component', fields: {}},
  'fs/fhd-fap12lcd-os2@1': {kind: 'module', fields: {}}, 'fs/fhd-fap6scd-os2@1': {kind: 'module', fields: {}},
};
export const slotsOf = ref => SLOTS[ref] ?? null;
export const compByRef = ref => COMPONENTS[ref] ?? null;
