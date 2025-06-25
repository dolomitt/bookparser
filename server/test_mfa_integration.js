import voicevoxService from './src/services/voicevoxService.js';
import mfaService from './src/services/mfaService.js';

// Test script to demonstrate MFA integration with VoiceVox
async function testMFAIntegration() {
  console.log('=== Testing MFA Integration with VoiceVox ===\n');

  // Test text (Japanese)
  const testText = 'こんにちは、世界！今日はいい天気ですね。';
  console.log(`Test text: ${testText}\n`);

  try {
    // Test 1: Check MFA availability
    console.log('1. Checking MFA availability...');
    const mfaAvailable = await mfaService.checkMFAAvailability();
    console.log(`MFA available: ${mfaAvailable}\n`);

    // Test 2: Generate speech with VoiceVox only
    console.log('2. Generating speech with VoiceVox only...');
    const voiceVoxResult = await voicevoxService.generateSpeech(testText, {
      includeTimings: true,
      speaker: 1
    });
    console.log(`VoiceVox timings: ${voiceVoxResult.timings.length} mora-level points`);
    console.log(`VoiceVox duration: ${voicevoxService.calculateAudioDuration(voiceVoxResult.timings)}s\n`);

    // Test 3: Generate speech with MFA enhancement
    console.log('3. Generating speech with MFA enhancement...');
    const mfaResult = await voicevoxService.generateSpeechWithMFA(testText, {
      speaker: 1,
      useMFA: true
    });
    console.log(`MFA alignment method: ${mfaResult.alignment.method}`);
    console.log(`MFA timings: ${mfaResult.timings.length} word-level points`);
    console.log(`MFA duration: ${mfaResult.alignment.stats.totalDuration || 'N/A'}s`);
    console.log(`Alignment stats:`, mfaResult.alignment.stats);

    // Test 4: Compare alignments
    console.log('\n4. Comparing alignment methods...');
    const comparison = voicevoxService.compareAlignments(
      voiceVoxResult.timings,
      mfaResult.timings
    );
    console.log('Comparison results:', JSON.stringify(comparison, null, 2));

    // Test 5: Display timing details
    console.log('\n5. Sample timing details:');
    console.log('VoiceVox (first 5 timings):');
    voiceVoxResult.timings.slice(0, 5).forEach((timing, i) => {
      console.log(`  ${i}: ${timing.startTime.toFixed(3)}s-${timing.endTime.toFixed(3)}s "${timing.text}"`);
    });

    console.log('\nMFA Enhanced (first 5 timings):');
    mfaResult.timings.slice(0, 5).forEach((timing, i) => {
      console.log(`  ${i}: ${timing.startTime.toFixed(3)}s-${timing.endTime.toFixed(3)}s "${timing.text}"`);
    });

    console.log('\n=== Test completed successfully! ===');

  } catch (error) {
    console.error('Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testMFAIntegration();
}

export { testMFAIntegration };
