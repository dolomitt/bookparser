import { config } from '../config/index.js';

class OllamaService {
  constructor() {
    this.baseUrl = config.ollama.baseUrl;
    this.model = config.ollama.model;
  }

  // Test Ollama connection and list available models
  async testConnection() {
    try {
      console.log('[Ollama] Testing connection to Ollama server...');
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        console.log('[Ollama] ✅ Connected to Ollama server');
        console.log('[Ollama] Available models:', data.models?.map(m => m.name) || 'No models found');
        
        // Check if our configured model exists
        const modelExists = data.models?.some(m => m.name === this.model);
        if (modelExists) {
          console.log(`[Ollama] ✅ Model "${this.model}" is available`);
        } else {
          console.log(`[Ollama] ⚠️ Model "${this.model}" not found. Available models:`, data.models?.map(m => m.name));
        }
      } else {
        console.log(`[Ollama] ❌ Failed to connect: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.log(`[Ollama] ❌ Connection test failed:`, error.message);
    }
  }

  // Get Ollama analysis for tokens
  async getAnalysis(originalText, tokens, contextLines = {}) {
    console.log('[Ollama] Starting Ollama analysis...');
    console.log('[Ollama] Original text:', originalText);
    console.log('[Ollama] Number of tokens:', tokens.length);

    try {
      const tokenList = tokens.map(token => token.surface).join(' | ');
      console.log('[Ollama] Token list for analysis:', tokenList);

      // Build context with previous and next lines
      let contextText = '';
      if (contextLines.previousSentence) {
        contextText += `Previous sentence: "${contextLines.previousSentence}"\n`;
      }
      contextText += `Current sentence: "${originalText}"`;
      if (contextLines.nextSentence) {
        contextText += `\nNext sentence: "${contextLines.nextSentence}"`;
      }

      console.log('[Ollama] Context text:', contextText);

      const prompt = `Analyze this Japanese sentence and provide translations and contextual explanations for each token, plus a full sentence translation.

Context:
${contextText}

Tokens to analyze: ${tokenList}

Please provide:
1. A complete, natural English translation of the entire sentence
2. Individual token analysis with translations and contextual explanations

Respond with ONLY a JSON object in this exact format:
{
  "fullLineTranslation": "Complete natural English translation of the entire sentence",
  "tokens": [
    {
      "surface": "友人",
      "translation": "friend",
      "contextualMeaning": "refers to the narrator as Holmes' friend",
      "grammaticalRole": "noun, subject"
    }
  ]
}`;

      console.log('[Ollama] 🚀 Sending request to Ollama API...');
      console.log('[Ollama] Using model:', this.model);
      console.log('[Ollama] Prompt length:', prompt.length, 'characters');

      const startTime = Date.now();
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
            top_k: 40,
            num_predict: 1000, // Limit response length
            stop: ["\n\n"] // Stop on double newline
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[Ollama] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Ollama] Error response body:`, errorText);
        throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const endTime = Date.now();
      
      console.log('[Ollama] ✅ Received response from Ollama API');
      console.log('[Ollama] Response time:', endTime - startTime, 'ms');

      const responseText = data.response;
      console.log('[Ollama] Raw response content:', responseText);

      // Try to parse JSON response - handle cases where there's text before the JSON
      try {
        // First try to parse the response directly
        const parsedResponse = JSON.parse(responseText);
        console.log('[Ollama] ✅ Successfully parsed JSON response');
        console.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
        console.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
        return parsedResponse;
      } catch (parseError) {
        console.log('[Ollama] Direct JSON parse failed, trying to extract JSON from response...');
        
        // Try to find JSON object in the response
        try {
          // Look for JSON object starting with { and ending with }
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const jsonString = jsonMatch[0];
            const parsedResponse = JSON.parse(jsonString);
            console.log('[Ollama] ✅ Successfully extracted and parsed JSON from response');
            console.log('[Ollama] Full line translation:', parsedResponse.fullLineTranslation);
            console.log('[Ollama] Number of token analyses:', parsedResponse.tokens?.length || 0);
            return parsedResponse;
          } else {
            console.error('[Ollama] ❌ No JSON object found in response');
            console.error('[Ollama] Raw response:', responseText);
            return null;
          }
        } catch (extractError) {
          console.error('[Ollama] ❌ Failed to extract and parse JSON from response:', extractError);
          console.error('[Ollama] Raw response that failed to parse:', responseText);
          return null;
        }
      }
    } catch (error) {
      console.error('[Ollama] ❌ Ollama API error:', error);
      console.error('[Ollama] Error type:', error.constructor.name);
      console.error('[Ollama] Error message:', error.message);
      
      if (error.code === 'ECONNREFUSED') {
        console.error('[Ollama] Cannot connect to Ollama server at:', this.baseUrl);
      } else if (error.name === 'AbortError') {
        console.error('[Ollama] Request timed out after 30 seconds');
        throw new Error('Ollama request timed out - try using local processing instead');
      }
      
      // Re-throw the error so it can be caught by the calling function
      throw error;
    }
  }
}

export default new OllamaService();
