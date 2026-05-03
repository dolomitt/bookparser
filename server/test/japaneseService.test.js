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

test('mergeNounCompounds keeps adjacent noun compounds as one reader token', () => {
  const input = [
    { surface_form: '生態', reading: 'セイタイ', pos: '名詞', pos_detail_1: '一般', basic_form: '生態', pronunciation: 'セイタイ' },
    { surface_form: '系', reading: 'ケイ', pos: '名詞', pos_detail_1: '接尾', basic_form: '系', pronunciation: 'ケイ' },
    { surface_form: 'の', reading: 'ノ', pos: '助詞', pos_detail_1: '連体化', basic_form: 'の', pronunciation: 'ノ' },
    { surface_form: '破壊', reading: 'ハカイ', pos: '名詞', pos_detail_1: 'サ変接続', basic_form: '破壊', pronunciation: 'ハカイ' }
  ];

  const output = japaneseService.mergeNounCompounds(input);

  assert.equal(output.length, 3);
  assert.equal(output[0].surface_form, '生態系');
  assert.equal(output[0].reading, 'セイタイケイ');
  assert.equal(output[0].pos_detail_1, 'compound');
  assert.equal(output[0].originalTokens.length, 2);
  assert.equal(output[1].surface_form, 'の');
  assert.equal(output[2].surface_form, '破壊');
});

test('mergeNounCompounds can be disabled', () => {
  const input = [
    { surface_form: '生態', reading: 'セイタイ', pos: '名詞', pos_detail_1: '一般', basic_form: '生態', pronunciation: 'セイタイ' },
    { surface_form: '系', reading: 'ケイ', pos: '名詞', pos_detail_1: '接尾', basic_form: '系', pronunciation: 'ケイ' }
  ];

  const output = japaneseService.mergeNounCompounds(input, { mergeNounCompounds: false });

  assert.equal(output.length, 2);
  assert.equal(output[0].surface_form, '生態');
  assert.equal(output[1].surface_form, '系');
});

test('normalizeTokenReading uses natural readings for numeric Japanese dates', () => {
  assert.equal(japaneseService.normalizeTokenReading('3月8日', '3ツキ8ニチ'), 'さんがつようか');
  assert.equal(japaneseService.normalizeTokenReading('３月８日', '3ツキ8ニチ'), 'さんがつようか');
  assert.equal(japaneseService.normalizeTokenReading('4月', '4ツキ'), 'しがつ');
  assert.equal(japaneseService.normalizeTokenReading('20日', '20ニチ'), 'はつか');
  assert.equal(japaneseService.normalizeTokenReading('24日', '24ニチ'), 'にじゅうよっか');
});
