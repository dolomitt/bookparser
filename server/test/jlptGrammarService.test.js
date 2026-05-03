import assert from 'node:assert/strict';
import { test } from 'node:test';
import jlptGrammarService from '../src/services/jlptGrammarService.js';

test('jlptGrammarService annotates grammar tokens with JLPT level and meaning', () => {
  const [token] = jlptGrammarService.annotateTokens([
    { surface_form: 'かもしれない', basic_form: 'かもしれない' }
  ]);

  assert.equal(token.jlptGrammar.level, 'N4');
  assert.equal(token.jlptGrammar.pattern, 'かもしれない');
  assert.match(token.jlptGrammar.meaning, /might|may/);
});

test('jlptGrammarService uses the lowest listed level for duplicate grammar patterns', () => {
  const [token] = jlptGrammarService.annotateTokens([
    { surface_form: 'という', basic_form: 'という' }
  ]);

  assert.equal(token.jlptGrammar.level, 'N3');
  assert.equal(token.jlptGrammar.pattern, 'という');
});
