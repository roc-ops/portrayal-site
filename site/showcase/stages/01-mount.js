// Stage 1 - Mount. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makeMount() {
  return {
    title: 'Mount',
    question: 'Will it fit?',
    async enter() {
      setPanel(title('Stage 1 · Mount'), lead('<strong>Will it fit?</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
