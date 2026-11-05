// Static page tests: the error overlay must actually hide, and a
// module-load failure must say so. Run: node --test tests/page.test.mjs
// Regression for the audit finding that `#webgl-error { display: grid }`
// overrode the `hidden` attribute in every browser, covering the game
// permanently with the "could not start" message.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const gameJs = readFileSync(join(root, 'js', 'game.js'), 'utf8');

describe('error overlay visibility', () => {
  it('a [hidden] rule with !important beats display rules on the overlay', () => {
    assert.match(css, /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/);
  });

  it('the overlay starts hidden in the markup', () => {
    assert.match(html, /id="webgl-error"[^>]*\bhidden\b/);
    assert.match(html, /id="webgl-error-detail"/);
    assert.match(html, /id="retry-button"/);
  });

  it('the module sets the load flag the watchdog checks', () => {
    assert.match(gameJs, /__flappyGameScriptLoaded\s*=\s*true/);
    assert.match(html, /__flappyGameScriptLoaded/);
    assert.match(html, /type="module"[^>]*src="js\/game\.js"/);
  });

});
