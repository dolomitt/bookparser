import assert from 'node:assert/strict';
import test from 'node:test';
import jlptVocabularyService from '../src/services/jlptVocabularyService.js';

test('jlptVocabularyService annotates tokens with vocabulary JLPT level', () => {
  const [token] = jlptVocabularyService.annotateTokens([
    { surface_form: '毎朝', reading: 'まいあさ', basic_form: '毎朝' }
  ]);

  assert.equal(token.jlptVocabulary.level, 'N5');
  assert.equal(token.jlptVocabulary.word, '毎朝');
  assert.equal(token.vocabularyJlptLevel, 'N5');
});

test('jlptVocabularyService can match by reading when surface form differs', () => {
  const [token] = jlptVocabularyService.annotateTokens([
    { surface_form: 'おちゃ', reading: 'おちゃ', basic_form: 'おちゃ' }
  ]);

  assert.equal(token.jlptVocabulary.level, 'N5');
  assert.equal(token.jlptVocabulary.word, 'お茶');
});
