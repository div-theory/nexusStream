import React, { useEffect, useRef, useState } from 'react';
import { GeminiLiveService } from '../services/geminiLiveService';
import { Button } from './Button';
import { Mic, MicOff, Power, AudioWaveform, Cpu, Terminal } from 'lucide-react';

export const GeminiLiveAssistant: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<{text: string, isUser: boolean, id: number}[]>([]);
  const [volume, setVolume] = useState(0); 
  
  const serviceRef = useRef<GeminiLiveService | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Visualization Loop
  useEffect(() => {
    let animationId: number;
    
    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      // Clear with slight fade for trail effect if desired, or hard clear
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // Grid Lines Background
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for(let i=0; i<width; i+=40) { ctx.moveTo(i,0); ctx.lineTo(i,height); }
      for(let i=0; i<height; i+=40) { ctx.moveTo(0,i); ctx.lineTo(width,i); }
      ctx.stroke();
      
      if (!isActive) {
          ctx.beginPath();
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
          return;
      }

      // Active state - Digital Audio Spectrum style
      ctx.beginPath();
      ctx.strokeStyle = '#2563EB'; // Blue Accent
      ctx.lineWidth = 2;
      
      const bars = 64;
      const barWidth = width / bars;
      
      for (let i = 0; i < bars; i++) {
        // Pseudo-random height based on volume and index
        const noise = Math.random() * 0.5 + 0.5;
        const h = Math.sin(i * 0.2 + Date.now() * 0.01) * (volume * 100) * noise;
        
        const x = i * barWidth;
        // Draw discrete bars
        ctx.moveTo(x, centerY - h);
        ctx.lineTo(x + barWidth - 2, centerY - h); // Top line
        
        ctx.moveTo(x, centerY + h);
        ctx.lineTo(x + barWidth - 2, centerY + h); // Bottom line
        
        // Vertical connector (optional, creates boxy feel)
        if (h > 2) {
             ctx.moveTo(x + barWidth/2, centerY - h);
             ctx.lineTo(x + barWidth/2, centerY + h);
        }
      }
      ctx.stroke();

      setVolume(prev => Math.max(0, prev * 0.92));
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, volume]);

  const toggleSession = async () => {
    if (isActive) {
      await serviceRef.current?.disconnect();
      setIsActive(false);
      return;
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setError("API Key missing.");
      return;
    }

    try {
      const service = new GeminiLiveService(apiKey);
      serviceRef.current = service;
      
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      nextStartTimeRef.current = outputContextRef.current.currentTime;

      await service.connect({
        apiKey,
        onOpen: () => {
          setIsActive(true);
          setError(null);
          setTranscripts(prev => [...prev, {id: Date.now(), text: "SYSTEM: Connection Established.", isUser: false}]);
        },
        onError: (e) => {
          setError(e.message);
          setIsActive(false);
        },
        onClose: () => {
          setIsActive(false);
        },
        onTranscription: (text, isUser, isFinal) => {
            if (isFinal) {
                setTranscripts(prev => {
                    if (prev.length > 0 && prev[prev.length - 1].text === text) return prev;
                    return [...prev, { id: Date.now(), text, isUser }];
                });
            }
        },
        onAudioData: (audioBuffer) => {
          if (!outputContextRef.current) return;
          const ctx = outputContextRef.current;
          setVolume(0.8); 
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          const now = ctx.currentTime;
          const startAt = Math.max(nextStartTimeRef.current, now);
          source.start(startAt);
          nextStartTimeRef.current = startAt + audioBuffer.duration;
        }
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-3 grid-rows-6">
        
        {/* Header / Info Block */}
        <div className="bento-cell md:col-span-1 md:row-span-6 p-8 flex flex-col border-r border-white/10">
            <div className="mb-8">
                <Cpu strokeWidth={1} size={48} className="text-white mb-4" />
                <h2 className="text-3xl font-thin text-white mb-2">GEMINI <br/><span className="text-blue-600 font-normal">LIVE</span></h2>
                <p className="text-zinc-500 font-light text-sm leading-relaxed">
                    Advanced multimodal reasoning engine capable of real-time audio processing and semantic understanding.
                </p>
            </div>

            <div className="mt-auto space-y-4">
                <div className="border border-white/10 p-4">
                    <div className="text-xs font-mono text-zinc-500 uppercase mb-1">Status</div>
                    <div className={`text-sm ${isActive ? 'text-blue-500 animate-pulse' : 'text-zinc-600'}`}>
                        {isActive ? 'ACTIVE LINK' : 'DISCONNECTED'}
                    </div>
                </div>

                <Button 
                    variant={isActive ? "danger" : "accent"} 
                    className="w-full flex items-center justify-center gap-3 py-4"
                    onClick={toggleSession}
                >
                    {isActive ? <Power size={18} /> : <Mic size={18} />}
                    {isActive ? "TERMINATE" : "INITIALIZE"}
                </Button>
            </div>
        </div>

        {/* Visualizer Block - Top Right */}
        <div className="bento-cell md:col-span-2 md:row-span-2 bg-black relative border-b border-white/10">
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <AudioWaveform size={14} className="text-zinc-500" />
                <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Audio Stream Processor</span>
            </div>
            <canvas ref={canvasRef} width={800} height={300} className="w-full h-full object-cover" />
        </div>

        {/* Transcript / Terminal Block - Bottom Right */}
        <div className="bento-cell md:col-span-2 md:row-span-4 bg-zinc-950 flex flex-col relative">
            <div className="absolute top-0 left-0 right-0 p-2 border-b border-white/5 bg-black/50 backdrop-blur flex justify-between items-center px-4">
                 <div className="flex items-center gap-2">
                    <Terminal size={12} className="text-zinc-500" />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">Live Transcription Log</span>
                 </div>
                 {error && <span className="text-[10px] text-red-500 font-mono uppercase">{error}</span>}
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 pt-12 space-y-6 font-mono text-sm">
                {transcripts.length === 0 && !isActive && (
                    <div className="text-zinc-700">Waiting for initialization...</div>
                )}
                {transcripts.map((t) => (
                    <div key={t.id} className={`flex flex-col ${t.isUser ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-zinc-600 mb-1 uppercase tracking-wider">
                            {t.isUser ? 'USER_INPUT' : 'MODEL_RESPONSE'}
                        </span>
                        <div className={`max-w-[80%] p-3 border ${t.isUser ? 'border-white/20 bg-zinc-900 text-white' : 'border-blue-900/30 bg-blue-950/10 text-blue-200'}`}>
                            {t.text}
                        </div>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    </div>
  );
};