import assert from 'node:assert/strict';
import { test } from 'node:test';
import japaneseService from '../src/services/japaneseService.js';

test('splitGrammarCompoundTokens splits にあたる into learner-friendly tokens', () => {
  const input = [{
    surface_form: 'にあたる',
    reading: 'ニアタル',
    pos: '助詞',
    pos_detail_1: '格助詞',
    pos_detail_2: '連語',
    pos_detail_3: '*',
    basic_form: 'にあたる',
    pronunciation: 'ニアタル'
  }];

  const output = japaneseService.splitGrammarCompoundTokens(input, { splitGrammarCompounds: true });

  assert.equal(output.length, 2);
  assert.equal(output[0].surface_form, 'に');
  assert.equal(output[1].surface_form, 'あたる');
  assert.equal(output[0].originalCompound, 'にあたる');
  assert.equal(output[1].originalCompound, 'にあたる');
  assert.equal(output[0].expressionSurface, 'にあたる');
  assert.ok(output[0].expressionMeaning.includes('correspond'));
});

test('splitGrammarCompoundTokens can be disabled', () => {
  const input = [{
    surface_form: 'にあたる',
    reading: 'ニアタル',
    pos: '助詞',
    pos_detail_1: '格助詞',
    pos_detail_2: '連語',
    pos_detail_3: '*',
    basic_form: 'にあたる',
    pronunciation: 'ニアタル'
  }];

  const output = japaneseService.splitGrammarCompoundTokens(input, { splitGrammarCompounds: false });

  assert.equal(output.length, 1);
  assert.equal(output[0].surface_form, 'にあたる');
});
