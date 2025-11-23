import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

interface GeminiLiveConfig {
  apiKey: string;
  onAudioData: (audioBuffer: AudioBuffer) => void;
  onTranscription?: (text: string, isUser: boolean, isFinal: boolean) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onOpen: () => void;
}

export class GeminiLiveService {
  private client: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private currentStream: MediaStream | null = null;
  private isConnected: boolean = false;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  public async connect(config: GeminiLiveConfig) {
    if (this.isConnected) return;

    try {
      // 1. Setup Audio Contexts
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // 2. Get User Media
      this.currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 3. Connect to Gemini Live
      this.sessionPromise = this.client.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Session Opened');
            this.isConnected = true;
            this.startAudioInputStreaming();
            config.onOpen();
          },
          onmessage: async (message: LiveServerMessage) => {
            await this.handleServerMessage(message, config);
          },
          onerror: (e: any) => {
            console.error('Gemini Live Error', e);
            config.onError(new Error(e.message || 'Unknown Gemini Error'));
          },
          onclose: () => {
            console.log('Gemini Live Session Closed');
            this.isConnected = false;
            config.onClose();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          systemInstruction: "You are a helpful, witty, and concise AI assistant integrated into a video chat application. Keep responses brief and conversational.",
        },
      });

    } catch (err) {
      config.onError(err as Error);
    }
  }

  private startAudioInputStreaming() {
    if (!this.inputAudioContext || !this.currentStream || !this.sessionPromise) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(this.currentStream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isConnected) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = this.createBlob(inputData);
      
      this.sessionPromise?.then((session) => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleServerMessage(message: LiveServerMessage, config: GeminiLiveConfig) {
    // Handle Audio
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext) {
      try {
        const audioData = this.decode(base64Audio);
        const audioBuffer = await this.decodeAudioData(audioData, this.outputAudioContext, 24000, 1);
        config.onAudioData(audioBuffer);
      } catch (e) {
        console.error("Error processing audio message", e);
      }
    }

    // Handle Transcriptions
    if (message.serverContent?.outputTranscription?.text) {
        config.onTranscription?.(message.serverContent.outputTranscription.text, false, !!message.serverContent.turnComplete);
    }
    if (message.serverContent?.inputTranscription?.text) {
        config.onTranscription?.(message.serverContent.inputTranscription.text, true, !!message.serverContent.turnComplete);
    }
  }

  public async disconnect() {
    this.isConnected = false;
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
    }
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
    }
    if (this.inputAudioContext) {
      await this.inputAudioContext.close();
    }
    if (this.outputAudioContext) {
      await this.outputAudioContext.close();
    }
    
    // Attempt to close session if API supports it, or just let the connection drop
    // this.sessionPromise?.then(s => s.close()); // If method exists
    this.sessionPromise = null;
  }

  // --- Helpers from Gemini Documentation ---

  private createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = Math.max(-1, Math.min(1, data[i])) * 32767; // Clamping
    }
    return {
      data: this.encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  private encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private decode(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private async decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
  ): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  }
}
