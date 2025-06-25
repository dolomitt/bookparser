import { useState, useCallback, useRef } from 'react';

export const useAudioPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const timeoutsRef = useRef([]);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    timeoutsRef.current = [];
  }, []);

  const createAudioFromBase64 = useCallback((base64Audio) => {
    const audioData = atob(base64Audio);
    const audioArray = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      audioArray[i] = audioData.charCodeAt(i);
    }
    const audioBlob = new Blob([audioArray], { type: 'audio/wav' });
    return URL.createObjectURL(audioBlob);
  }, []);

  const createAudioFromBlob = useCallback((blob) => {
    const audioBlob = new Blob([blob], { type: 'audio/wav' });
    return URL.createObjectURL(audioBlob);
  }, []);

  const playAudio = useCallback((audioUrl, onEnded = null) => {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
    }

    audioRef.current = new Audio(audioUrl);
    setIsPlaying(true);

    const handleEnded = () => {
      setIsPlaying(false);
      URL.revokeObjectURL(audioUrl);
      if (onEnded) onEnded();
    };

    audioRef.current.addEventListener('ended', handleEnded);
    audioRef.current.addEventListener('pause', () => setIsPlaying(false));
    audioRef.current.addEventListener('abort', () => setIsPlaying(false));

    audioRef.current.play().catch(error => {
      console.error('Audio playback failed:', error);
      setIsPlaying(false);
      URL.revokeObjectURL(audioUrl);
    });

    return audioRef.current;
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
    clearTimeouts();
  }, [clearTimeouts]);

  const scheduleTimeout = useCallback((callback, delay) => {
    const timeout = setTimeout(callback, delay);
    timeoutsRef.current.push(timeout);
    return timeout;
  }, []);

  return {
    isPlaying,
    createAudioFromBase64,
    createAudioFromBlob,
    playAudio,
    stopAudio,
    scheduleTimeout,
    clearTimeouts
  };
};
