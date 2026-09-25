// Stage 3 - Seat optics. A placeholder until its own task replaces this file: the
// rail's contract is the list of stages, so every rung is a real registered
// stage from the start.

import {setPanel, title, lead} from '../artifact.js';

export default function makeOptics() {
  return {
    title: 'Seat optics',
    question: 'What media, speed and lanes?',
    async enter() {
      setPanel(title('Stage 3 · Seat optics'), lead('<strong>What media, speed and lanes?</strong>'),
               lead('This stage is not built yet.'));
    },
    exit() {},
  };
}
