// Stage 6 - Take it away. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makeTakeaway() {
  return {
    title: 'Take it away',
    question: 'Where can it go from here?',
    async enter() {
      setPanel(title('Stage 6 · Take it away'), lead('<strong>Where can it go from here?</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
