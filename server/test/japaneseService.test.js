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

test('mergeNominalizedNounPhrases keeps noun の verb-stem 方 as one reader token', () => {
  const input = [
    { surface_form: 'ストレス', reading: 'ストレス', pos: '名詞', pos_detail_1: '一般', basic_form: 'ストレス', pronunciation: 'ストレス' },
    { surface_form: 'の', reading: 'ノ', pos: '助詞', pos_detail_1: '連体化', basic_form: 'の', pronunciation: 'ノ' },
    { surface_form: '感じ', reading: 'カンジ', pos: '動詞', pos_detail_1: '自立', basic_form: '感じる', pronunciation: 'カンジ' },
    { surface_form: '方', reading: 'カタ', pos: '名詞', pos_detail_1: '接尾', basic_form: '方', pronunciation: 'カタ' },
    { surface_form: '。', reading: '。', pos: '記号', pos_detail_1: '句点', basic_form: '。', pronunciation: '。' }
  ];

  const output = japaneseService.mergeNominalizedNounPhrases(input);

  assert.equal(output.length, 2);
  assert.equal(output[0].surface_form, 'ストレスの感じ方');
  assert.equal(output[0].reading, 'ストレスノカンジカタ');
  assert.equal(output[0].pos, '名詞');
  assert.equal(output[0].mergeReason, 'noun_no_verbstem_kata');
  assert.equal(output[1].surface_form, '。');
});

test('mergeCoordinatedNounPhrases keeps noun と noun as one reader token', () => {
  const input = [
    { surface_form: '腸', reading: 'チョウ', pos: '名詞', pos_detail_1: '一般', basic_form: '腸', pronunciation: 'チョウ' },
    { surface_form: 'と', reading: 'ト', pos: '助詞', pos_detail_1: '並立助詞', basic_form: 'と', pronunciation: 'ト' },
    { surface_form: '脳', reading: 'ノウ', pos: '名詞', pos_detail_1: '一般', basic_form: '脳', pronunciation: 'ノウ' },
    { surface_form: 'を通じて', reading: 'ヲツウジテ', pos: '助詞', pos_detail_1: '格助詞', basic_form: 'を通じて', pronunciation: 'ヲツウジテ' }
  ];

  const output = japaneseService.mergeCoordinatedNounPhrases(input);

  assert.equal(output.length, 2);
  assert.equal(output[0].surface_form, '腸と脳');
  assert.equal(output[0].reading, 'チョウトノウ');
  assert.equal(output[0].pos, '名詞');
  assert.equal(output[0].mergeReason, 'noun_to_noun');
  assert.equal(output[1].surface_form, 'を通じて');
});

test('mergeAuxiliarySequences keeps だった as one reader token', () => {
  const input = [
    { surface_form: 'だっ', reading: 'ダッ', pos: '助動詞', pos_detail_1: '*', basic_form: 'だ', pronunciation: 'ダッ' },
    { surface_form: 'た', reading: 'タ', pos: '助動詞', pos_detail_1: '*', basic_form: 'た', pronunciation: 'タ' },
    { surface_form: 'と', reading: 'ト', pos: '助詞', pos_detail_1: '格助詞', basic_form: 'と', pronunciation: 'ト' }
  ];

  const output = japaneseService.mergeAuxiliarySequences(input);

  assert.equal(output.length, 2);
  assert.equal(output[0].surface_form, 'だった');
  assert.equal(output[0].reading, 'ダッタ');
  assert.equal(output[0].pos, '助動詞');
  assert.equal(output[0].basic_form, 'だ');
  assert.equal(output[0].mergeReason, 'auxiliary_sequence');
  assert.equal(output[1].surface_form, 'と');
});

test('mergeGrammarExpressions keeps かもしれない as one reader token', () => {
  const input = [
    { surface_form: '多い', reading: 'オオイ', pos: '形容詞', pos_detail_1: '自立', basic_form: '多い', pronunciation: 'オオイ' },
    { surface_form: 'かも', reading: 'カモ', pos: '助詞', pos_detail_1: '副助詞', basic_form: 'かも', pronunciation: 'カモ' },
    { surface_form: 'しれない', reading: 'シレナイ', pos: '動詞', pos_detail_1: 'inflected', basic_form: 'しれる', pronunciation: 'シレナイ' },
    { surface_form: '。', reading: '。', pos: '記号', pos_detail_1: '句点', basic_form: '。', pronunciation: '。' }
  ];

  const output = japaneseService.mergeGrammarExpressions(input);

  assert.equal(output.length, 3);
  assert.equal(output[0].surface_form, '多い');
  assert.equal(output[1].surface_form, 'かもしれない');
  assert.equal(output[1].reading, 'カモシレナイ');
  assert.equal(output[1].mergeReason, 'grammar_expression');
  assert.ok(output[1].expressionMeaning.includes('might'));
  assert.equal(output[2].surface_form, '。');
});

test('mergeGrammarExpressions keeps という as one reader token', () => {
  const input = [
    { surface_form: 'れた', reading: 'レタ', pos: '動詞', pos_detail_1: 'inflected', basic_form: 'れる', pronunciation: 'レタ' },
    { surface_form: 'と', reading: 'ト', pos: '助詞', pos_detail_1: '格助詞', basic_form: 'と', pronunciation: 'ト' },
    { surface_form: 'いう', reading: 'イウ', pos: '動詞', pos_detail_1: '自立', basic_form: 'いう', pronunciation: 'イウ' },
    { surface_form: '。', reading: '。', pos: '記号', pos_detail_1: '句点', basic_form: '。', pronunciation: '。' }
  ];

  const output = japaneseService.mergeGrammarExpressions(input);

  assert.equal(output.length, 3);
  assert.equal(output[0].surface_form, 'れた');
  assert.equal(output[1].surface_form, 'という');
  assert.equal(output[1].reading, 'トイウ');
  assert.equal(output[1].mergeReason, 'grammar_expression');
  assert.ok(output[1].expressionMeaning.includes('called'));
  assert.equal(output[2].surface_form, '。');
});

test('normalizeTokenReading uses natural readings for numeric Japanese dates', () => {
  assert.equal(japaneseService.normalizeTokenReading('3月8日', '3ツキ8ニチ'), 'さんがつようか');
  assert.equal(japaneseService.normalizeTokenReading('３月８日', '3ツキ8ニチ'), 'さんがつようか');
  assert.equal(japaneseService.normalizeTokenReading('4月', '4ツキ'), 'しがつ');
  assert.equal(japaneseService.normalizeTokenReading('20日', '20ニチ'), 'はつか');
  assert.equal(japaneseService.normalizeTokenReading('24日', '24ニチ'), 'にじゅうよっか');
});
