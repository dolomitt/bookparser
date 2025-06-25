// Test script to demonstrate the MFA-enhanced API endpoints
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';

async function testMFAAPI() {
  console.log('=== Testing MFA-Enhanced API Endpoints ===\n');

  const testText = 'こんにちは、世界！今日はいい天気ですね。';
  console.log(`Test text: ${testText}\n`);

  try {
    // Test 1: Enhanced TTS with MFA
    console.log('1. Testing Enhanced TTS with MFA...');
    const enhancedResponse = await fetch(`${BASE_URL}/api/text-to-speech/enhanced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        speaker: 1,
        useMFA: true,
        language: 'japanese_mfa'
      })
    });

    if (enhancedResponse.ok) {
      const enhancedResult = await enhancedResponse.json();
      console.log(`✓ Enhanced TTS successful`);
      console.log(`  - Alignment method: ${enhancedResult.alignment.method}`);
      console.log(`  - Timing points: ${enhancedResult.timings.length}`);
      console.log(`  - Audio format: ${enhancedResult.audioFormat}`);
      console.log(`  - Sample rate: ${enhancedResult.sampleRate}Hz`);
      console.log(`  - Enhanced: ${enhancedResult.enhanced}`);
      
      if (enhancedResult.alignment.stats) {
        console.log(`  - Stats:`, enhancedResult.alignment.stats);
      }
    } else {
      console.log(`✗ Enhanced TTS failed: ${enhancedResponse.status} ${enhancedResponse.statusText}`);
      const error = await enhancedResponse.json();
      console.log(`  Error: ${error.error}`);
    }

    console.log('\n');

    // Test 2: Compare alignment methods
    console.log('2. Testing Alignment Comparison...');
    const compareResponse = await fetch(`${BASE_URL}/api/text-to-speech/compare-alignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        speaker: 1
      })
    });

    if (compareResponse.ok) {
      const compareResult = await compareResponse.json();
      console.log(`✓ Alignment comparison successful`);
      console.log(`  - VoiceVox timings: ${compareResult.voiceVoxOnly.timings.length} (${compareResult.voiceVoxOnly.stats.type})`);
      console.log(`  - MFA timings: ${compareResult.mfaEnhanced.timings.length} (${compareResult.mfaEnhanced.stats.type})`);
      console.log(`  - MFA method: ${compareResult.mfaEnhanced.method}`);
      console.log(`  - Recommended: ${compareResult.comparison.improvement.recommended}`);
      
      console.log('\n  Comparison details:');
      console.log(`    - Granularity change: ${compareResult.comparison.improvement.granularityChange}`);
      console.log(`    - Duration difference: ${compareResult.comparison.improvement.durationDifference.toFixed(3)}s`);
      
      // Show sample timings
      console.log('\n  Sample VoiceVox timings (first 3):');
      compareResult.voiceVoxOnly.timings.slice(0, 3).forEach((timing, i) => {
        console.log(`    ${i}: ${timing.startTime.toFixed(3)}s-${timing.endTime.toFixed(3)}s "${timing.text}"`);
      });
      
      console.log('\n  Sample MFA timings (first 3):');
      compareResult.mfaEnhanced.timings.slice(0, 3).forEach((timing, i) => {
        console.log(`    ${i}: ${timing.startTime.toFixed(3)}s-${timing.endTime.toFixed(3)}s "${timing.text}"`);
      });
      
    } else {
      console.log(`✗ Alignment comparison failed: ${compareResponse.status} ${compareResponse.statusText}`);
      const error = await compareResponse.json();
      console.log(`  Error: ${error.error}`);
    }

    console.log('\n');

    // Test 3: Regular TTS for comparison
    console.log('3. Testing Regular TTS (for comparison)...');
    const regularResponse = await fetch(`${BASE_URL}/api/text-to-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        speaker: 1,
        includeTimings: true
      })
    });

    if (regularResponse.ok) {
      const regularResult = await regularResponse.json();
      console.log(`✓ Regular TTS successful`);
      console.log(`  - Timing points: ${regularResult.timings.length} (mora-level)`);
      console.log(`  - Audio format: ${regularResult.audioFormat}`);
      console.log(`  - Sample rate: ${regularResult.sampleRate}Hz`);
    } else {
      console.log(`✗ Regular TTS failed: ${regularResponse.status} ${regularResponse.statusText}`);
    }

    console.log('\n=== API Test completed ===');

  } catch (error) {
    console.error('Test failed with error:', error);
    console.error('Make sure the server is running on http://localhost:5000');
  }
}

// Run the test
testMFAAPI();
