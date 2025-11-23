import React, { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { MediaService } from '../services/mediaService';
import { Camera, Mic, Settings2, User, ArrowRight, Loader2 } from 'lucide-react';
import { UserSettings } from '../types';

interface PreCallLobbyProps {
  onJoin: (stream: MediaStream, settings: UserSettings) => void;
}

export const PreCallLobby: React.FC<PreCallLobbyProps> = ({ onJoin }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [displayName, setDisplayName] = useState('');
  
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);

  // 1. Initial Setup: Get Permissions & Devices
  useEffect(() => {
    const initLobby = async () => {
      try {
        setLoading(true);
        // Request initial stream to trigger permissions
        const initialStream = await MediaService.getRobustStream();
        setStream(initialStream);
        
        // Enumerate devices now that we have permissions
        const devices = await MediaService.getDevices();
        setAudioDevices(devices.audio);
        setVideoDevices(devices.video);
        
        // Set defaults based on current track settings
        const videoTrack = initialStream.getVideoTracks()[0];
        const audioTrack = initialStream.getAudioTracks()[0];
        
        if (videoTrack) setSelectedVideo(videoTrack.getSettings().deviceId || '');
        if (audioTrack) setSelectedAudio(audioTrack.getSettings().deviceId || '');
        
      } catch (e: any) {
        setError(MediaService.getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    };
    initLobby();

    return () => {
      stopAnalysis();
      // Don't stop the stream here, we might pass it to the call
    };
  }, []);

  // 2. Handle Device Switching
  const handleDeviceChange = async (audioId?: string, videoId?: string) => {
    try {
      // Stop old tracks
      stream?.getTracks().forEach(t => t.stop());
      
      const newAudioId = audioId ?? selectedAudio;
      const newVideoId = videoId ?? selectedVideo;

      const newStream = await MediaService.getStreamWithDeviceId(newAudioId, newVideoId);
      setStream(newStream);
      
      if (audioId) setSelectedAudio(audioId);
      if (videoId) setSelectedVideo(videoId);
      
      setError(null);
    } catch (e: any) {
      setError("Failed to switch device: " + e.message);
    }
  };

  // 3. Bind Stream to Video Element & Audio Analysis
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      setupAudioAnalysis(stream);
    }
  }, [stream]);

  const setupAudioAnalysis = (currentStream: MediaStream) => {
    if (!currentStream.getAudioTracks().length) return;
    
    stopAnalysis();

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(currentStream);
    const analyser = ctx.createAnalyser();
    
    analyser.fftSize = 64;
    source.connect(analyser);
    
    audioContextRef.current = ctx;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateLevel = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(avg);
      animationRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  };

  const stopAnalysis = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
  };

  const handleEnter = () => {
    if (stream) {
      onJoin(stream, {
        displayName: displayName || 'Anonymous',
        audioDeviceId: selectedAudio,
        videoDeviceId: selectedVideo
      });
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background flex-col gap-4">
        <Loader2 className="animate-spin text-accent" size={32} />
        <div className="text-secondary font-mono text-xs uppercase tracking-widest">Checking Devices...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-4 md:p-8 flex items-center justify-center bg-background text-primary">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 h-full max-h-[800px]">
        
        {/* LEFT: PREVIEW */}
        <div className="flex flex-col gap-4">
          <div className="relative aspect-video rounded-3xl overflow-hidden bg-black border border-border shadow-2xl">
             {error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                   <div className="text-red-500 mb-2 font-mono uppercase tracking-widest">Camera Error</div>
                   <div className="text-zinc-400 text-sm">{error}</div>
                   <Button variant="secondary" className="mt-4 rounded-full" onClick={() => window.location.reload()}>Reload</Button>
                </div>
             ) : (
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
             )}
             
             {/* Audio Meter Overlay */}
             <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/50 backdrop-blur px-4 py-2 rounded-full border border-white/10">
               <div className="flex gap-1 items-end h-4">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`w-1 rounded-full transition-all duration-75 ${audioLevel > (i * 10 + 10) ? 'bg-green-500 h-full' : 'bg-zinc-600 h-1.5'}`}
                    ></div>
                  ))}
               </div>
               <span className="text-[10px] font-mono text-white/80 uppercase tracking-widest">Mic Check</span>
             </div>
          </div>

          <div className="p-6 bg-surface rounded-3xl border border-border flex flex-col gap-4">
             <div className="flex items-center gap-2 text-primary mb-2">
                <Settings2 size={16} />
                <span className="text-xs font-mono uppercase tracking-widest">Input Config</span>
             </div>
             
             <div className="grid gap-4">
                <div className="relative">
                   <div className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><Camera size={16} /></div>
                   <select 
                      value={selectedVideo} 
                      onChange={(e) => handleDeviceChange(undefined, e.target.value)}
                      className="w-full bg-input border border-border rounded-xl py-3 pl-10 pr-4 text-sm text-primary appearance-none focus:outline-none focus:border-accent transition-colors shadow-sm"
                   >
                      {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,4)}...`}</option>)}
                   </select>
                </div>
                <div className="relative">
                   <div className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><Mic size={16} /></div>
                   <select 
                      value={selectedAudio} 
                      onChange={(e) => handleDeviceChange(e.target.value, undefined)}
                      className="w-full bg-input border border-border rounded-xl py-3 pl-10 pr-4 text-sm text-primary appearance-none focus:outline-none focus:border-accent transition-colors shadow-sm"
                   >
                      {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,4)}...`}</option>)}
                   </select>
                </div>
             </div>
          </div>
        </div>

        {/* RIGHT: IDENTITY & JOIN */}
        <div className="flex flex-col justify-center p-8 bg-surface rounded-3xl border border-border relative overflow-hidden shadow-sm">
           <div className="relative z-10 flex flex-col h-full">
              <h1 className="text-4xl md:text-5xl font-black text-primary tracking-tighter mb-2">
                Talkr<span className="text-accent">.</span> Lobby
              </h1>
              <p className="text-secondary mb-12 text-sm">Configure your secure uplink before connecting.</p>

              <div className="space-y-6 max-w-md">
                 <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-secondary mb-2">Display Alias</label>
                    <div className="relative">
                       <User className="absolute left-4 top-1/2 -translate-y-1/2 text-secondary" size={18} />
                       <input 
                          type="text" 
                          placeholder="ANONYMOUS" 
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="w-full bg-input border border-border rounded-2xl py-4 pl-12 pr-4 text-lg font-bold text-primary placeholder:text-secondary focus:outline-none focus:border-accent transition-all shadow-sm"
                       />
                    </div>
                 </div>

                 <div className="pt-8">
                    <Button 
                       variant="primary" 
                       size="lg" 
                       className="w-full py-6 text-base rounded-full bg-accent border-accent hover:bg-accent/90 hover:border-accent/90 text-white flex items-center justify-between group"
                       onClick={handleEnter}
                       disabled={!stream}
                    >
                       <span className="font-bold tracking-widest pl-2">ENTER STUDIO</span>
                       <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:translate-x-1 transition-transform">
                          <ArrowRight size={16} />
                       </div>
                    </Button>
                    <p className="text-center text-[10px] text-secondary mt-4 font-mono uppercase">
                       End-to-End Encrypted Session
                    </p>
                 </div>
              </div>
           </div>
           
           {/* Decorative Background */}
           <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
        </div>

      </div>
    </div>
  );
};