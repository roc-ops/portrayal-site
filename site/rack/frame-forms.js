// THE FORMS A RACK PRODUCT COMES IN, as the catalogue states them: the distinct `form` of rack.json's `frames`.
// Nothing here knows a form by name, so a form the catalogue adds is offered the day it does. Pure: the picker
// (frame-form.js) and the assistant's find_rack_products (agent-tools.js) both read it.

export const formsOf = frames => [...new Set(Object.values(frames ?? {}).map(r => r.form).filter(Boolean))].sort();

// How the picker words a form: the catalogue's own word, read as words (`4-post-cabinet` -> `4 post cabinet`).
export const formLabel = form => String(form).replace(/-/g, ' ');
