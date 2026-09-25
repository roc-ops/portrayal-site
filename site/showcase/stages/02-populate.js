// Stage 2 - Populate. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makePopulate() {
  return {
    title: 'Populate',
    question: 'What does this bay accept?',
    async enter() {
      setPanel(title('Stage 2 · Populate'), lead('<strong>What does this bay accept?</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
