// Stage 5 - Filter. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makeFilter() {
  return {
    title: 'Filter',
    question: 'Show me just management.',
    async enter() {
      setPanel(title('Stage 5 · Filter'), lead('<strong>Show me just management.</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
