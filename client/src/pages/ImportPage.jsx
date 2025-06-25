import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ImportPage.css';

// Cookie utility functions
const setCookie = (name, value, days = 30) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
};

const getCookie = (name) => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) {
      try {
        return JSON.parse(c.substring(nameEQ.length, c.length));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

export default function ImportPage() {
  const { filename } = useParams();
  const navigate = useNavigate();
  const [lines, setLines] = useState([]);
  const [sentences, setSentences] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [sentenceMessages, setSentenceMessages] = useState({});
  const [processedSentences, setProcessedSentences] = useState({});
  // Load settings from cookies with fallback to defaults
  const [verbMergeOptions, setVerbMergeOptions] = useState(() => {
    const saved = getCookie('verbMergeOptions');
    return saved || {
      mergeAuxiliaryVerbs: true,
      mergeVerbParticles: true,
      mergeVerbSuffixes: true,
      mergeTeForm: true,
      mergeMasuForm: true,
      mergeAllInflections: true,
      mergePunctuation: true,
      useCompoundDetection: false
    };
  });
  
  const [showVerbOptions, setShowVerbOptions] = useState(() => {
    const saved = getCookie('showVerbOptions');
    return saved !== null ? saved : false;
  });
  
  const [ttsOptions, setTtsOptions] = useState(() => {
    const saved = getCookie('ttsOptions');
    return saved || {
      speed: 1.0,
      speaker: 1,
      volume: 1.0
    };
  });
  
  const [showTtsOptions, setShowTtsOptions] = useState(() => {
    const saved = getCookie('showTtsOptions');
    return saved !== null ? saved : false;
  });
  const fileInput = useRef();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [sentencesPerPage] = useState(50); // Show 50 sentences per page

  // Separate useEffect for initial load only
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  
  // Save settings to cookies when they change
  useEffect(() => {
    setCookie('verbMergeOptions', verbMergeOptions);
  }, [verbMergeOptions]);
  
  useEffect(() => {
    setCookie('showVerbOptions', showVerbOptions);
  }, [showVerbOptions]);
  
  useEffect(() => {
    setCookie('ttsOptions', ttsOptions);
  }, [ttsOptions]);
  
  useEffect(() => {
    setCookie('showTtsOptions', showTtsOptions);
  }, [showTtsOptions]);
  
  // Function to split text into sentences using Japanese dot (。)
  const splitIntoSentences = (text) => {
    // Split by Japanese period (。) and preserve the period with each sentence
    const parts = text.split('。');
    const sentences = [];
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part) {
        // Add the period back except for the last part (which might not have one)
        const sentence = i < parts.length - 1 ? part + '。' : part;
        sentences.push(sentence);
      }
    }
    
    return sentences;
  };

  useEffect(() => {
    if (filename && !initialLoadComplete) {
      console.log('Initial load for:', filename);
      axios.get(`/api/import/${filename}`).then(res => {
        console.log('File data loaded:', res.data);
        setLines(res.data.lines);

        // Split all lines into sentences
        const allSentences = [];
        res.data.lines.forEach((line, lineIndex) => {
          if (line.trim()) {
            const lineSentences = splitIntoSentences(line);
            lineSentences.forEach((sentence, sentenceIndexInLine) => {
              allSentences.push({
                text: sentence,
                originalLineIndex: lineIndex,
                originalLine: line
              });
            });
            // Add a line break after each line that contains sentences
            allSentences.push({
              text: '',
              originalLineIndex: lineIndex,
              originalLine: line,
              isLineBreak: true
            });
          } else {
            // Preserve empty lines as line breaks
            allSentences.push({
              text: '',
              originalLineIndex: lineIndex,
              originalLine: line,
              isLineBreak: true
            });
          }
        });
        
        setSentences(allSentences);
        console.log(`Split ${res.data.lines.length} lines into ${allSentences.length} sentences`);

        // Load existing processed sentences if available
        if (res.data.existingProcessedSentences && Object.keys(res.data.existingProcessedSentences).length > 0) {
          console.log('Loading existing processed sentences:', res.data.existingProcessedSentences);
          setProcessedSentences(res.data.existingProcessedSentences);
          console.log(`Loaded ${Object.keys(res.data.existingProcessedSentences).length} previously processed sentences`);
        }

        // Load existing verb merge options if available
        if (res.data.existingVerbMergeOptions && Object.keys(res.data.existingVerbMergeOptions).length > 0) {
          setVerbMergeOptions(prev => ({
            ...prev,
            ...res.data.existingVerbMergeOptions
          }));
          console.log('Loaded existing verb merge options:', res.data.existingVerbMergeOptions);
        }
        
        setInitialLoadComplete(true);
        
        // Only auto-process if there are unprocessed sentences
        const unprocessedCount = allSentences.filter((s, i) => !s.isLineBreak && !res.data.existingProcessedSentences[i]).length;
        if (unprocessedCount > 0) {
          console.log(`Found ${unprocessedCount} unprocessed sentences, starting auto-processing...`);
          setTimeout(() => {
            autoProcessAllSentences(allSentences);
          }, 100);
        } else {
          console.log('All sentences already processed, skipping auto-processing');
          setMessage('All sentences already processed - ready for reading!');
          setTimeout(() => setMessage(''), 3000);
        }
      }).catch(error => {
        console.error('Error loading file data:', error);
        setInitialLoadComplete(true);
      });
    }
  }, [filename, initialLoadComplete]);

  const handleFileChange = e => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/import', formData);
      
      if (res.data.autoProcessed) {
        setMessage(`✅ Uploaded and auto-processed: ${res.data.originalname} (${res.data.processedLines}/${res.data.totalLines} lines processed)`);
      } else if (res.data.error) {
        setMessage(`⚠️ Uploaded: ${res.data.originalname} - ${res.data.error}`);
      } else {
        setMessage(`Uploaded: ${res.data.originalname}`);
      }
      
      navigate(`/import/${res.data.filename}`);
    } catch (err) {
      setMessage('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleTextToSpeech = async (sentenceIndex, withTimings = false) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    console.log('Text-to-speech button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('With timings:', withTimings);

    // Set processing message for this specific sentence
    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: 'Generating speech...' }));

    try {
      if (withTimings) {
        // Request audio with timing data using TTS options
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          includeTimings: true,
          speaker: ttsOptions.speaker,
          speed: ttsOptions.speed,
          volume: ttsOptions.volume
        });

        console.log('Received audio and timing response from server');
        const { audio, timings, audioFormat, sampleRate } = response.data;

        // Convert base64 audio to blob
        const audioData = atob(audio);
        const audioArray = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          audioArray[i] = audioData.charCodeAt(i);
        }
        const audioBlob = new Blob([audioArray], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio element
        const audioElement = new Audio(audioUrl);
        
        // Set up timing-based text highlighting
        let highlightTimeouts = [];
        let currentHighlight = null;
        
        const clearHighlights = () => {
          highlightTimeouts.forEach(timeout => clearTimeout(timeout));
          highlightTimeouts = [];
          if (currentHighlight) {
            currentHighlight.style.backgroundColor = 'transparent';
            currentHighlight = null;
          }
        };

        // Get the processed sentence data to access tokens
        let processedSentence = processedSentences[sentenceIndex];
        if (!processedSentence || !processedSentence.tokens) {
          console.log('No processed tokens available, running local processing first...');
          
          try {
            // Run local processing automatically
            const requestData = {
              text: sentence.text,
              sentenceIndex: sentenceIndex,
              verbMergeOptions: verbMergeOptions,
              allSentences: sentences.map(s => s.text),
              useRemoteProcessing: false // Use local processing
            };

            const response = await axios.post('/api/parse', requestData);
            
            if (response.data.analysis && response.data.analysis.tokens) {
              const sentenceData = {
                tokens: response.data.analysis.tokens,
                fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
                processingType: 'local'
              };
              
              // Update the processed sentences state
              setProcessedSentences(prev => ({ ...prev, [sentenceIndex]: sentenceData }));
              
              // Auto-save the processed data
              setTimeout(() => {
                autoSave(sentenceIndex, sentenceData);
              }, 100);
              
              // Use the newly processed sentence data
              processedSentence = sentenceData;
              console.log('Local processing completed, proceeding with highlighting');
            } else {
              console.warn('Local processing failed, playing audio without highlighting');
              audioElement.play();
              audioElement.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
              });
              return;
            }
          } catch (error) {
            console.error('Auto-processing error:', error);
            console.warn('Auto-processing failed, playing audio without highlighting');
            audioElement.play();
            audioElement.addEventListener('ended', () => {
              URL.revokeObjectURL(audioUrl);
            });
            return;
          }
        }

        // Use VOICEVOX timing data to synchronize highlighting with actual audio
        const mapTimingsToTokens = (timings, tokens) => {
          console.log('[TIMING] Starting VOICEVOX timing mapping');
          console.log('[TIMING] Original text:', sentence.text);
          console.log('[TIMING] All tokens:', tokens.map((t, i) => `${i}:${t.surface}(${t.pos})`));
          console.log('[TIMING] VOICEVOX timings:', timings.length, 'entries');
          
          // Show detailed VOICEVOX timing data
          console.log('[TIMING] === VOICEVOX TIMING POINTS ===');
          timings.forEach((timing, index) => {
            console.log(`[TIMING] ${index}: ${timing.startTime.toFixed(3)}-${timing.endTime.toFixed(3)}s | text:"${timing.text || timing.mora || ''}" | textStart:${timing.textStart || 'N/A'} textEnd:${timing.textEnd || 'N/A'} | phraseIndex:${timing.phraseIndex || 'N/A'} moraIndex:${timing.moraIndex || 'N/A'}`);
          });
          console.log('[TIMING] === END TIMING POINTS ===');
          
          // Filter out punctuation tokens
          const nonPunctuationTokens = [];
          tokens.forEach((token, originalIndex) => {
            if (token.pos !== '記号') {
              nonPunctuationTokens.push({ ...token, originalIndex });
            }
          });
          
          console.log('[TIMING] Non-punctuation tokens:', nonPunctuationTokens.map(t => `${t.originalIndex}:${t.surface}`));
          
          if (nonPunctuationTokens.length === 0) {
            console.log('[TIMING] No tokens to highlight');
            return [];
          }
          
          if (!timings || timings.length === 0) {
            console.log('[TIMING] No VOICEVOX timings available, using fallback');
            // Fallback to simple timing
            const totalDuration = 3.0;
            const tokenDuration = totalDuration / nonPunctuationTokens.length;
            
            return nonPunctuationTokens.map((token, sequenceIndex) => {
              const startTime = sequenceIndex * tokenDuration;
              const endTime = startTime + tokenDuration;
              
              return {
                tokenIndex: token.originalIndex,
                startTime,
                endTime,
                token: token.surface,
                sequenceIndex
              };
            });
          }
          
          // Use actual VOICEVOX timing data
          const audioStartTime = timings[0].startTime;
          const audioEndTime = timings[timings.length - 1].endTime;
          const totalDuration = audioEndTime - audioStartTime;
          
          console.log(`[TIMING] VOICEVOX audio: ${audioStartTime.toFixed(3)}s - ${audioEndTime.toFixed(3)}s (${totalDuration.toFixed(3)}s total)`);
          
          // Create a mapping from text positions to timing data
          const textToTimingMap = new Map();
          let currentTextPos = 0;
          
          // Build a map of text positions to VOICEVOX timings
          timings.forEach((timing, index) => {
            const timingText = timing.text || timing.mora || '';
            if (timingText) {
              textToTimingMap.set(currentTextPos, timing);
              currentTextPos += timingText.length;
            }
          });
          
          console.log('[TIMING] Built text-to-timing map with', textToTimingMap.size, 'entries');
          
          // Map each token to its corresponding timing
          const tokenTimings = [];
          let textPosition = 0;
          
          nonPunctuationTokens.forEach((token, sequenceIndex) => {
            // Find the text position of this token in the original sentence
            let tokenTextPos = 0;
            for (let i = 0; i < token.originalIndex; i++) {
              tokenTextPos += tokens[i].surface.length;
            }
            
            console.log(`[TIMING] Token "${token.surface}" at text position ${tokenTextPos}`);
            
            // Find VOICEVOX timings that overlap with this token
            const tokenLength = token.surface.length;
            const overlappingTimings = timings.filter(timing => {
              const timingStart = timing.textStart || 0;
              const timingEnd = timing.textEnd || (timingStart + (timing.text?.length || 1));
              
              // Check if timing overlaps with token position
              return (timingStart < tokenTextPos + tokenLength && timingEnd > tokenTextPos);
            });
            
            let startTime, endTime;
            
            if (overlappingTimings.length > 0) {
              // Use actual VOICEVOX timing
              startTime = Math.min(...overlappingTimings.map(t => t.startTime));
              endTime = Math.max(...overlappingTimings.map(t => t.endTime));
              console.log(`[TIMING] Token "${token.surface}" mapped to VOICEVOX timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s`);
            } else {
              // Fallback: distribute remaining time evenly
              const avgTokenDuration = totalDuration / nonPunctuationTokens.length;
              startTime = audioStartTime + (sequenceIndex * avgTokenDuration);
              endTime = startTime + avgTokenDuration;
              console.log(`[TIMING] Token "${token.surface}" using fallback timing: ${startTime.toFixed(3)}-${endTime.toFixed(3)}s`);
            }
            
            tokenTimings.push({
              tokenIndex: token.originalIndex,
              startTime,
              endTime,
              token: token.surface,
              sequenceIndex,
              hasVoicevoxTiming: overlappingTimings.length > 0
            });
          });
          
          // Sort by start time to ensure proper order
          tokenTimings.sort((a, b) => a.startTime - b.startTime);
          
          console.log('[TIMING] Final token timings:');
          tokenTimings.forEach(t => {
            console.log(`  ${t.sequenceIndex}: "${t.token}" ${t.startTime.toFixed(3)}-${t.endTime.toFixed(3)}s ${t.hasVoicevoxTiming ? '(VOICEVOX)' : '(fallback)'}`);
          });
          
          return tokenTimings;
        };

        const tokenTimings = mapTimingsToTokens(timings, processedSentence.tokens);
        console.log('Token timings:', tokenTimings);

        // Schedule highlighting for each token
        tokenTimings.forEach((tokenTiming) => {
          const timeout = setTimeout(() => {
            // Clear previous highlight
            if (currentHighlight) {
              currentHighlight.style.backgroundColor = 'transparent';
              currentHighlight.style.color = '';
            }
            
            // Find the specific token to highlight
            const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenTiming.tokenIndex}"]`);
            if (tokenElement) {
              tokenElement.style.backgroundColor = '#ffeb3b';
              tokenElement.style.color = '#000';
              tokenElement.style.transition = 'background-color 0.1s ease, color 0.1s ease';
              tokenElement.style.borderRadius = '4px';
              // Don't change padding to avoid text movement
              currentHighlight = tokenElement;
            }
          }, tokenTiming.startTime * 1000); // Convert to milliseconds
          
          highlightTimeouts.push(timeout);
          
          // Schedule clearing of this specific highlight
          const clearTimeout = setTimeout(() => {
            const tokenElement = document.querySelector(`[data-token="${sentenceIndex}-${tokenTiming.tokenIndex}"]`);
            if (tokenElement) {
              tokenElement.style.backgroundColor = 'transparent';
              tokenElement.style.color = '';
            }
          }, tokenTiming.endTime * 1000);
          
          highlightTimeouts.push(clearTimeout);
        });

        // Clear highlights when audio ends
        audioElement.addEventListener('ended', () => {
          clearHighlights();
          URL.revokeObjectURL(audioUrl);
        });

        // Clear highlights if audio is paused/stopped
        audioElement.addEventListener('pause', clearHighlights);
        audioElement.addEventListener('abort', clearHighlights);

        audioElement.play();

      } else {
        // Original behavior - audio only
        const response = await axios.post('/api/text-to-speech', {
          text: sentence.text,
          includeTimings: false
        }, {
          responseType: 'blob'
        });

        console.log('Received audio response from server');

        // Create audio blob and play it
        const audioBlob = new Blob([response.data], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Create and play audio element
        const audio = new Audio(audioUrl);
        audio.play();

        // Clean up the object URL after playing
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
        });
      }

      // Clear message after successful generation
      setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));

    } catch (error) {
      console.error('Text-to-speech error:', error);
      
      let errorMessage = 'Speech generation failed';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.status === 503) {
        errorMessage = 'Cannot connect to VOICEVOX engine';
      } else if (error.response?.status === 502) {
        errorMessage = 'VOICEVOX engine error';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = `Speech error: ${error.message}`;
      }

      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: errorMessage
      }));

      // Clear error message after 3 seconds
      setTimeout(() => {
        setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));
      }, 3000);
    }
  };

  const handleSentenceProcess = async (sentenceIndex, useRemoteProcessing = true) => {
    const sentence = sentences[sentenceIndex];
    if (!sentence || sentence.isLineBreak) return;

    console.log('Process button clicked for sentence index:', sentenceIndex);
    console.log('Sentence text:', sentence.text);
    console.log('Verb merge options:', verbMergeOptions);
    console.log('Use remote processing (OpenAI):', useRemoteProcessing);

    // Set processing message for this specific sentence
    const processingMessage = useRemoteProcessing ? 'Processing with AI...' : 'Processing locally...';
    setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: processingMessage }));

    try {
      const requestData = {
        text: sentence.text,
        sentenceIndex: sentenceIndex,
        verbMergeOptions: verbMergeOptions,
        allSentences: sentences.map(s => s.text),
        useRemoteProcessing: useRemoteProcessing
      };
      console.log('Sending request to /api/parse with data:', requestData);

      const response = await axios.post('/api/parse', requestData);
      console.log('Received response:', response.data);

      // Clear message for this specific sentence after successful processing
      setSentenceMessages(prev => ({ ...prev, [sentenceIndex]: '' }));

      // Store the processed tokens and full sentence translation for interactive display
      if (response.data.analysis && response.data.analysis.tokens) {
        const sentenceData = {
          tokens: response.data.analysis.tokens,
          fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
          processingType: useRemoteProcessing ? 'remote' : 'local'
        };
        
        console.log('Setting processed sentence data for index:', sentenceIndex, sentenceData);
        
        setProcessedSentences(prev => {
          const updatedSentences = { ...prev, [sentenceIndex]: sentenceData };
          console.log('Updated processed sentences state:', updatedSentences);
          return updatedSentences;
        });

        // Auto-save after processing with a longer delay to ensure state is set
        setTimeout(() => {
          console.log('Auto-saving sentence:', sentenceIndex);
          autoSave(sentenceIndex, sentenceData);
        }, 500);
      }
    } catch (error) {
      console.error('Processing error:', error);
      console.error('Error response:', error.response?.data);

      // Set error message for this specific sentence with better network error handling
      let errorMessage = 'Unknown error';
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        errorMessage = 'Server not running. Please start the server with "npm run dev" in the bookparser directory.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else {
        errorMessage = error.message;
      }

      setSentenceMessages(prev => ({
        ...prev,
        [sentenceIndex]: `Error: ${errorMessage}`
      }));
    }
  };

  const handleVerbOptionChange = (option, value) => {
    setVerbMergeOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const handleTtsOptionChange = (option, value) => {
    setTtsOptions(prev => ({
      ...prev,
      [option]: value
    }));
  };

  const autoSave = async (sentenceIndex, sentenceData) => {
    try {
      // Save only the specific sentence that was processed
      const saveData = {
        sentenceIndex: sentenceIndex,
        sentenceData: sentenceData,
        verbMergeOptions: verbMergeOptions,
        timestamp: new Date().toISOString()
      };

      await axios.post(`/api/import/${filename}/save-sentence`, saveData);
      console.log(`Auto-saved sentence ${sentenceIndex}`);
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  };

  const autoProcessAllSentences = async (allSentences) => {
    console.log('Starting automatic local processing for unprocessed sentences...');
    
    let processedCount = 0;
    let skippedCount = 0;
    const totalSentences = allSentences.filter(s => !s.isLineBreak).length;
    
    // Check how many sentences are already processed
    const alreadyProcessedCount = Object.keys(processedSentences).length;
    
    if (alreadyProcessedCount > 0) {
      console.log(`Found ${alreadyProcessedCount} already processed sentences, skipping auto-processing for those`);
      setMessage(`Found ${alreadyProcessedCount} already processed sentences. Processing remaining sentences...`);
    } else {
      setMessage('Auto-processing sentences with local dictionary...');
    }
    
    for (let i = 0; i < allSentences.length; i++) {
      const sentence = allSentences[i];
      
      // Skip line breaks
      if (sentence.isLineBreak) continue;
      
      // Skip already processed sentences
      if (processedSentences[i]) {
        skippedCount++;
        console.log(`Skipping sentence ${i} - already processed`);
        continue;
      }
      
      try {
        console.log(`Auto-processing sentence ${i}: "${sentence.text.substring(0, 30)}..."`);
        
        const requestData = {
          text: sentence.text,
          sentenceIndex: i,
          verbMergeOptions: verbMergeOptions,
          allSentences: allSentences.map(s => s.text),
          useRemoteProcessing: false // Use local processing only
        };

        const response = await axios.post('/api/parse', requestData);
        
        if (response.data.analysis && response.data.analysis.tokens) {
          const sentenceData = {
            tokens: response.data.analysis.tokens,
            fullSentenceTranslation: response.data.fullSentenceTranslation || 'N/A',
            processingType: 'local'
          };
          
          // Update the processed sentences state
          setProcessedSentences(prev => ({ ...prev, [i]: sentenceData }));
          
          // Auto-save the processed data
          setTimeout(() => {
            autoSave(i, sentenceData);
          }, 50);
          
          processedCount++;
          
          // Update progress message
          const totalProcessed = skippedCount + processedCount;
          setMessage(`Auto-processing: ${totalProcessed}/${totalSentences} sentences completed (${processedCount} new, ${skippedCount} existing)`);
        }
        
        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.error(`Error auto-processing sentence ${i}:`, error);
        // Continue with next sentence even if one fails
      }
    }
    
    const totalProcessed = skippedCount + processedCount;
    console.log(`Auto-processing completed: ${totalProcessed}/${totalSentences} sentences total (${processedCount} newly processed, ${skippedCount} already existed)`);
    
    if (processedCount > 0) {
      setMessage(`Auto-processing completed: ${processedCount} new sentences processed with local dictionary (${skippedCount} already existed)`);
    } else {
      setMessage(`All ${totalSentences} sentences were already processed - no new processing needed`);
    }
    
    // Clear the message after 5 seconds
    setTimeout(() => {
      setMessage('');
    }, 5000);
  };

  const handleSave = async () => {
    setMessage('Saving...');
    try {
      // Prepare the complete book data with all processed information
      const bookData = {
        bookname: filename,
        originalLines: lines,
        processedSentences: processedSentences,
        sentences: sentences,
        verbMergeOptions: verbMergeOptions,
        metadata: {
          totalLines: lines.length,
          totalSentences: sentences.length,
          processedSentences: Object.keys(processedSentences).length,
          savedAt: new Date().toISOString()
        }
      };

      await axios.post(`/api/import/${filename}/save`, bookData);
      setMessage('Saved to books with all processed data!');
    } catch (error) {
      console.error('Save error:', error);
      setMessage('Save failed');
    }
  };

  // Function to check if a character is kanji
  const isKanji = (char) => {
    const code = char.charCodeAt(0);
    return (code >= 0x4e00 && code <= 0x9faf) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df); // CJK Extension B
  };

  // Function to check if token contains kanji
  const hasKanji = (text) => {
    return text.split('').some(char => isKanji(char));
  };

  // Component to render tokenized text with mobile-friendly popup functionality and ruby text
  const TokenizedText = ({ tokens, sentenceIndex }) => {
    const [activePopup, setActivePopup] = useState(null);
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

    const handleTokenClick = (e, token, tokenIdx) => {
      console.log('Token clicked:', token, 'Index:', tokenIdx);
      
      if (token.pos === '記号') {
        console.log('Skipping punctuation token');
        return; // Skip punctuation
      }

      e.preventDefault();
      e.stopPropagation();

      // Calculate popup position with better viewport handling
      const rect = e.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate initial position - bottom of popup should be 20 pixels above the click
      let x = rect.left + (rect.width / 2);
      let y = rect.top - 20; // Position so bottom of popup is 20px above click
      
      // Adjust for viewport boundaries
      const popupWidth = 320; // max-width from CSS
      
      // Keep popup within horizontal bounds
      if (x - popupWidth/2 < 10) {
        x = popupWidth/2 + 10;
      } else if (x + popupWidth/2 > viewportWidth - 10) {
        x = viewportWidth - popupWidth/2 - 10;
      }
      
      // Keep popup within vertical bounds - if not enough space above, show below
      if (y < 10) {
        y = rect.bottom + 20; // Show below token with 20px gap if not enough space above
      }

      console.log('Popup position:', { x, y });
      console.log('Current activePopup:', activePopup);

      setPopupPosition({ x, y });
      const newActivePopup = activePopup === `${sentenceIndex}-${tokenIdx}` ? null : `${sentenceIndex}-${tokenIdx}`;
      console.log('Setting activePopup to:', newActivePopup);
      setActivePopup(newActivePopup);
    };

    const closePopup = () => {
      console.log('Closing popup');
      setActivePopup(null);
    };

    // Close popup when clicking outside
    React.useEffect(() => {
      const handleClickOutside = (e) => {
        if (activePopup !== null && !e.target.closest('.token-popup') && !e.target.closest('[data-token]')) {
          console.log('Clicking outside popup, closing');
          closePopup();
        }
      };

      if (activePopup !== null) {
        document.addEventListener('click', handleClickOutside, true);
        document.addEventListener('touchstart', handleClickOutside, true);
      }

      return () => {
        document.removeEventListener('click', handleClickOutside, true);
        document.removeEventListener('touchstart', handleClickOutside, true);
      };
    }, [activePopup]);

    return (
      <div style={{ display: 'inline', position: 'relative' }}>
        {tokens.map((token, tokenIdx) => {
          // Check if this is a merged verb (from server-side processing)
          const isMergedVerb = token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected');
          const isPunctuation = token.pos === '記号';
          const shouldShowRuby = hasKanji(token.surface) && token.reading && token.reading !== token.surface;
          const hasAIData = token.translation && token.translation !== 'N/A';

          // Determine token color based on type and AI analysis
          let tokenColor = '#f2f2f2';
          let activeColor;

          if (!isPunctuation) {
            if (isMergedVerb) {
              activeColor = hasAIData ? '#4a7c59' : '#2d7d32';
            } else if (token.pos === '動詞') {
              activeColor = hasAIData ? '#6b46c1' : '#7c3aed';
            } else {
              activeColor = hasAIData ? '#2b6cb0' : '#007bff';
            }
          }

          const tokenContent = (
            <>
              {shouldShowRuby ? (
                <ruby style={{ fontSize: 'inherit', pointerEvents: 'none' }}>
                  {token.surface}
                  <rt style={{
                    fontSize: '0.75em',
                    color: '#ccc',
                    fontWeight: 'normal',
                    pointerEvents: 'none'
                  }}>
                    {token.reading}
                  </rt>
                </ruby>
              ) : (
                token.surface
              )}
            </>
          );

          const isActive = activePopup === `${sentenceIndex}-${tokenIdx}`;

          return (
            <span
              key={tokenIdx}
              data-token={`${sentenceIndex}-${tokenIdx}`}
              style={{
                display: 'inline-flex',
                margin: '0px 1px',
                padding: '2px 3px',
                backgroundColor: isActive && !isPunctuation ? activeColor : 'transparent',
                color: isActive && !isPunctuation ? 'white' : tokenColor,
                borderRadius: '2px',
                cursor: isPunctuation ? 'default' : 'pointer',
                fontSize: '1.1em',
                border: 'none',
                fontWeight: 'normal',
                transition: 'background-color 0.2s ease, color 0.2s ease',
                minHeight: '28px',
                minWidth: '16px',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                lineHeight: '1.5'
              }}
              onClick={(e) => handleTokenClick(e, token, tokenIdx)}
              onTouchStart={(e) => {
                if (!isPunctuation) {
                  e.preventDefault();
                }
              }}
            >
              {tokenContent}
            </span>
          );
        })}

        {/* Token popup for both mobile and desktop */}
        {activePopup !== null && activePopup.startsWith(`${sentenceIndex}-`) && (
          (() => {
            const tokenIdx = parseInt(activePopup.split('-')[1]);
            const token = tokens[tokenIdx];
            if (!token) return null;

            return (
              <div
                className="token-popup"
                style={{
                  position: 'fixed',
                  left: `${popupPosition.x}px`,
                  bottom: `${window.innerHeight - popupPosition.y}px`,
                  transform: 'translateX(-50%)',
                  backgroundColor: '#1a1a1a',
                  border: '3px solid #4fc3f7',
                  borderRadius: '8px',
                  padding: '16px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
                  zIndex: 99999,
                  maxWidth: '320px',
                  minWidth: '220px',
                  fontSize: '0.95em',
                  color: '#f2f2f2',
                  lineHeight: '1.5',
                  pointerEvents: 'auto',
                  display: 'block',
                  visibility: 'visible'
                }}
              >
                <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#4fc3f7' }}>
                  {token.surface}
                </div>
                
                {token.reading && token.reading !== token.surface && (
                  <div style={{ marginBottom: '6px', color: '#ccc', fontSize: '0.85em' }}>
                    <strong>Reading:</strong> {token.reading}
                  </div>
                )}

                {token.pos === '動詞' && (token.pos_detail === 'compound' || token.pos_detail === 'inflected') && (
                  <div style={{ marginBottom: '6px', color: '#4a7c59', fontSize: '0.8em' }}>
                    🔗 Merged Verb Token
                  </div>
                )}

                {token.translation && token.translation !== 'N/A' && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Translation:</strong> {token.translation}
                  </div>
                )}

                {token.contextualMeaning && token.contextualMeaning !== 'N/A' && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Context:</strong> {token.contextualMeaning}
                  </div>
                )}

                {token.grammaticalRole && token.grammaticalRole !== token.pos && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong>Grammar:</strong> {token.grammaticalRole}
                  </div>
                )}

                {/* Close button for mobile */}
                <button
                  onClick={closePopup}
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    fontSize: '16px',
                    cursor: 'pointer',
                    padding: '4px',
                    lineHeight: '1'
                  }}
                >
                  ×
                </button>
              </div>
            );
          })()
        )}
      </div>
    );
  };

  // Pagination calculations
  const totalSentences = sentences.filter(s => !s.isLineBreak).length;
  const totalPages = Math.ceil(totalSentences / sentencesPerPage);
  
  // Get sentences for current page
  const getPaginatedSentences = () => {
    let sentenceCount = 0;
    let startIndex = -1;
    let endIndex = -1;
    
    // Find start index for current page
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].isLineBreak) {
        sentenceCount++;
        if (sentenceCount === (currentPage - 1) * sentencesPerPage + 1) {
          startIndex = i;
          break;
        }
      }
    }
    
    // Find end index for current page
    sentenceCount = 0;
    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].isLineBreak) {
        sentenceCount++;
        if (sentenceCount === currentPage * sentencesPerPage) {
          endIndex = i;
          break;
        }
      }
    }
    
    // If we didn't find an end index, use the last sentence
    if (endIndex === -1) {
      endIndex = sentences.length - 1;
    }
    
    // Include line breaks that fall within our range
    const result = [];
    for (let i = startIndex; i <= endIndex; i++) {
      if (i >= 0 && i < sentences.length) {
        result.push({ ...sentences[i], originalIndex: i });
      }
    }
    
    return result;
  };

  const paginatedSentences = sentences.length > 0 ? getPaginatedSentences() : [];

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top when changing pages
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="container">
      <h2>Import Books</h2>
      {!filename && (
        <div>
          <input type="file" ref={fileInput} onChange={handleFileChange} accept=".txt" />
          <button onClick={handleUpload} disabled={uploading} className="btn">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      )}
      {filename && (
        <div>
          <h3>File: {filename}</h3>
          <div className="controls-section">
            <button onClick={handleSave} className="btn">Save to Books</button>
            <button
              onClick={() => setShowTtsOptions(!showTtsOptions)}
              className="btn"
            >
              {showTtsOptions ? 'Hide' : 'Show'} TTS Options
            </button>
            <button
              onClick={() => setShowVerbOptions(!showVerbOptions)}
              className="btn"
            >
              {showVerbOptions ? 'Hide' : 'Show'} Verb Options
            </button>
          </div>

          {showTtsOptions && (
            <div className="options-panel">
              <h4>Text-to-Speech Options</h4>
              <p>
                Configure VOICEVOX speech synthesis settings:
              </p>

              <div className="tts-options-grid">
                <div className="tts-option-group">
                  <label>
                    Speech Speed
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={ttsOptions.speed}
                    onChange={(e) => handleTtsOptionChange('speed', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {ttsOptions.speed}x
                  </div>
                </div>

                <div className="tts-option-group">
                  <label>
                    Speaker Voice
                  </label>
                  <select
                    value={ttsOptions.speaker}
                    onChange={(e) => handleTtsOptionChange('speaker', parseInt(e.target.value))}
                  >
                    <option value={1}>Speaker 1 (四国めたん)</option>
                    <option value={2}>Speaker 2 (ずんだもん)</option>
                    <option value={3}>Speaker 3 (春日部つむぎ)</option>
                    <option value={8}>Speaker 8 (青山龍星)</option>
                    <option value={13}>Speaker 13 (白上虎太郎)</option>
                  </select>
                </div>

                <div className="tts-option-group">
                  <label>
                    Volume
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={ttsOptions.volume}
                    onChange={(e) => handleTtsOptionChange('volume', parseFloat(e.target.value))}
                  />
                  <div className="tts-option-value">
                    {Math.round(ttsOptions.volume * 100)}%
                  </div>
                </div>
              </div>

              <div className="note">
                <strong>Note:</strong> Speed and volume settings will be applied to future speech generation. 
                Speaker selection requires VOICEVOX engine to support the selected voice.
              </div>
            </div>
          )}

          {showVerbOptions && (
            <div className="options-panel">
              <h4>Japanese Verb Tokenization Options</h4>
              <p>
                Configure how Japanese verbs are merged to keep them as single tokens:
              </p>

              <div className="verb-options-grid">
                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAuxiliaryVerbs}
                    onChange={(e) => handleVerbOptionChange('mergeAuxiliaryVerbs', e.target.checked)}
                  />
                  Merge Auxiliary Verbs (助動詞)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbParticles}
                    onChange={(e) => handleVerbOptionChange('mergeVerbParticles', e.target.checked)}
                  />
                  Merge Verb Particles (助詞)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeVerbSuffixes}
                    onChange={(e) => handleVerbOptionChange('mergeVerbSuffixes', e.target.checked)}
                  />
                  Merge Verb Suffixes (接尾)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeTeForm}
                    onChange={(e) => handleVerbOptionChange('mergeTeForm', e.target.checked)}
                  />
                  Merge Te-form (て/で)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeMasuForm}
                    onChange={(e) => handleVerbOptionChange('mergeMasuForm', e.target.checked)}
                  />
                  Merge Masu-form (ます/ました)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergeAllInflections}
                    onChange={(e) => handleVerbOptionChange('mergeAllInflections', e.target.checked)}
                  />
                  Merge ALL Inflections (Complete)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.mergePunctuation}
                    onChange={(e) => handleVerbOptionChange('mergePunctuation', e.target.checked)}
                  />
                  Merge Punctuation (記号)
                </label>

                <label className="verb-option-label">
                  <input
                    type="checkbox"
                    checked={verbMergeOptions.useCompoundDetection}
                    onChange={(e) => handleVerbOptionChange('useCompoundDetection', e.target.checked)}
                  />
                  Detect Compound Verbs
                </label>
              </div>
            </div>
          )}

          {/* Pagination info and controls - TOP */}
          {totalPages > 1 && (
            <>
              <div className="pagination-info">
                <span>
                  Page {currentPage} of {totalPages} ({totalSentences} total sentences)
                </span>
              </div>
              
              <div className="pagination-controls">
                <button 
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className="btn pagination-btn"
                >
                  First
                </button>
                <button 
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="btn pagination-btn"
                >
                  Previous
                </button>
                
                <span className="pagination-pages">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`btn pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </span>
                
                <button 
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn"
                >
                  Next
                </button>
                <button 
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className="btn pagination-btn"
                >
                  Last
                </button>
              </div>
            </>
          )}

          <div className="import-content">
              {paginatedSentences.map((sentence, index) => {
                const sentenceIndex = sentence.originalIndex;
                
                if (sentence.isLineBreak) {
                  return <br key={sentenceIndex} />;
                }

                const isProcessed = processedSentences[sentenceIndex];
                const hasRemoteTranslation = isProcessed && isProcessed.processingType === 'remote' && 
                  isProcessed.fullSentenceTranslation && isProcessed.fullSentenceTranslation !== 'N/A';

                return (
                  <span key={sentenceIndex} className="sentence-container">
                    {isProcessed ? (
                      <span data-sentence={sentenceIndex}>
                        <TokenizedText tokens={isProcessed.tokens} sentenceIndex={sentenceIndex} />
                      </span>
                    ) : (
                      <span data-sentence={sentenceIndex} className="sentence-text">{sentence.text}</span>
                    )}
                    
                    {/* Processing buttons - inline after sentence */}
                    <span className="sentence-controls">
                      <button 
                        onClick={() => handleSentenceProcess(sentenceIndex, false)} 
                        className="sentence-btn local"
                        title="Process using local dictionary only (JMDict)"
                      >
                        L
                      </button>
                      <button 
                        onClick={() => handleSentenceProcess(sentenceIndex, true)} 
                        className="sentence-btn remote"
                        title="Process using OpenAI for enhanced translations"
                      >
                        R
                      </button>
                      
                      {/* Text-to-speech with timing button */}
                      <button 
                        onClick={() => handleTextToSpeech(sentenceIndex, true)} 
                        className="sentence-btn tts"
                        title="Generate speech with real-time highlighting using VOICEVOX"
                      >
                        🔊
                      </button>
                      
                      {/* Translation popup button - only visible after remote processing */}
                      {hasRemoteTranslation && (
                        <button 
                          onClick={() => {
                            const popup = document.getElementById(`translation-popup-${sentenceIndex}`);
                            if (popup) {
                              popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
                            }
                          }}
                          className="sentence-btn translation"
                          title="Show sentence translation"
                        >
                          💬
                        </button>
                      )}
                    </span>

                    {/* Processing status message */}
                    {sentenceMessages[sentenceIndex] && (
                      <span className={`sentence-status ${sentenceMessages[sentenceIndex].startsWith('Error') ? 'error' : 'success'}`}>
                        {sentenceMessages[sentenceIndex]}
                      </span>
                    )}

                    {/* Translation popup */}
                    {hasRemoteTranslation && (
                      <div
                        id={`translation-popup-${sentenceIndex}`}
                        className="translation-popup"
                      >
                        <div className="translation-popup-label">
                          Translation
                        </div>
                        <div>
                          {isProcessed.fullSentenceTranslation}
                        </div>
                        <button
                          onClick={() => {
                            document.getElementById(`translation-popup-${sentenceIndex}`).style.display = 'none';
                          }}
                          className="translation-popup-close"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    
                    {' '} {/* Space between sentences */}
                  </span>
                );
              })}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button 
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="btn pagination-btn"
              >
                First
              </button>
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="btn pagination-btn"
              >
                Previous
              </button>
              
              <span className="pagination-pages">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`btn pagination-btn ${currentPage === pageNum ? 'active' : ''}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </span>
              
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn"
              >
                Next
              </button>
              <button 
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="btn pagination-btn"
              >
                Last
              </button>
            </div>
          )}
        </div>
      )}
      {message && <div className="message">{message}</div>}
    </div>
  );
}
