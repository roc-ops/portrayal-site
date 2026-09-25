// Stage 4 - Cable. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makeCable() {
  return {
    title: 'Cable',
    question: 'What is connected to what?',
    async enter() {
      setPanel(title('Stage 4 · Cable'), lead('<strong>What is connected to what?</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
