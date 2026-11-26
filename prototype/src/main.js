// Boot file: build the real systems and hand them to the Game orchestrator.
// Keeping the orchestrator in src/game.js lets the integration tests inject
// stub renderer/minimap/audio/HUD/input objects and run the whole loop in Node.
//
// Boot order matters for the preview: any throw here would otherwise leave the
// loading panel on screen with no explanation, so failures go to window.__boot.

import { Game } from './game.js';

function fail(where, err) {
  const detail = err?.message ?? String(err);
  window.__boot?.report(where, detail);
}

try {
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('missing #game canvas');

  // three r187 needs WebGL 2; say so plainly instead of failing inside the renderer.
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2') && !canvas.getContext('webgl2')) {
    throw new Error('this browser has no WebGL 2 context; enable hardware acceleration or try another browser');
  }

  const game = new Game({
    onFirstFrame: () => {
      game.hud.setLoading(1, 'Ready');
      game.hud.hideLoading();
    },
  });
  window.__game = game;
  game.run();
} catch (err) {
  fail('boot', err);
}
