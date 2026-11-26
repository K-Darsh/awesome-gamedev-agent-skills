// Boot file: build the real systems and hand them to the Game orchestrator.
// Keeping the orchestrator in src/game.js lets the integration tests inject
// stub renderer/minimap/audio/HUD/input objects and run the whole loop in Node.

import { Game } from './game.js';

const game = new Game();
window.__game = game;
game.run();

setTimeout(() => {
  game.hud.setLoading(1, 'Ready');
  game.hud.hideLoading();
}, 450);
