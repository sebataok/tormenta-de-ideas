// voice.js — Push-to-talk con Web Speech API (primaria) + MediaRecorder para audio crudo.
// El audio crudo se guarda base64 para que el backend pueda refinar con Whisper.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isSpeechSupported() {
  return !!SpeechRecognition;
}

export class VoiceCapture {
  constructor({ lang = 'es-CL', onInterim, onFinal, onStart, onEnd, onError } = {}) {
    this.lang = lang;
    this.onInterim = onInterim || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onError = onError || (() => {});
    this.recognizer = null;
    this.recorder = null;
    this.chunks = [];
    this.audioBlob = null;
    this.finalText = '';
    this.stream = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.finalText = '';
    this.chunks = [];
    this.audioBlob = null;

    // --- MediaRecorder para audio crudo ---
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mime = mimeCandidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.recorder.onstop = () => {
        this.audioBlob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
      };
      this.recorder.start();
    } catch (e) {
      // El usuario negó el micrófono; seguimos igual porque Web Speech en Safari usa su propia captura.
      console.warn('MediaRecorder no disponible', e);
    }

    // --- Web Speech API ---
    if (!SpeechRecognition) {
      this.onError({ message: 'Web Speech API no soportada; se guarda solo el audio.' });
    } else {
      const rec = new SpeechRecognition();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false; // en iOS es lo más estable
      rec.maxAlternatives = 1;

      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            this.finalText += (this.finalText ? ' ' : '') + r[0].transcript.trim();
          } else {
            interim += r[0].transcript;
          }
        }
        if (interim) this.onInterim(interim);
        if (this.finalText) this.onFinal(this.finalText);
      };
      rec.onerror = (e) => { this.onError({ message: e.error || 'speech-error' }); };
      rec.onend = () => {
        // Si el usuario aún está grabando, reintentar (Safari corta seguido)
        if (this.running) {
          try { rec.start(); } catch (_) {}
        }
      };
      rec.start();
      this.recognizer = rec;
      this.onStart();
    }
  }

  async stop() {
    if (!this.running) return null;
    this.running = false;

    if (this.recognizer) {
      try { this.recognizer.stop(); } catch (_) {}
      this.recognizer = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      await new Promise((res) => {
        const prev = this.recorder.onstop;
        this.recorder.onstop = (e) => { prev && prev(e); res(); };
        try { this.recorder.stop(); } catch { res(); }
      });
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.onEnd();
    return {
      text: this.finalText.trim(),
      audioBlob: this.audioBlob
    };
  }
}

export async function blobToBase64(blob) {
  if (!blob) return null;
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
