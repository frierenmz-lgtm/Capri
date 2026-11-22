/** Longest piece of text sent to the voice in one request. */
export const MAX_SPEECH_CHARS = 1200;
/** Largest voice note accepted (about 2 minutes of WAV audio). */
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
/** Recording stops by itself after this many seconds. */
export const MAX_RECORDING_SECONDS = 120;
/** Quiet time after speaking that ends a voice-mode turn. */
export const VOICE_SILENCE_MS = 1400;
