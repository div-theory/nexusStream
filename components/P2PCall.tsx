import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { Button } from './Button';
import { 
  Camera, CameraOff, Mic, MicOff, Monitor, PhoneOff, 
  Copy, Signal, MonitorOff, UserPlus, Zap, Check, Eye, Loader2,
  AlertCircle
} from 'lucide-react';

// Types for PeerJS components to avoid strict build errors
type MediaConnection = any;
type DataConnection = any;

interface PeerStatus {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
}

interface P2PCallProps {
  onEndCall: () => void;
}

export const P2PCall: React.FC<P2PCallProps> = ({ onEndCall }) => {
  const [peerId, setPeerId] = useState<string>('');
  const [remotePeerIdValue, setRemotePeerIdValue] = useState('');
  
  // Connections
  const [currentCall, setCurrentCall] = useState<MediaConnection | null>(null);
  const [currentDataConn, setCurrentDataConn] = useState<DataConnection | null>(null);
  
  // Streams
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  // Local State
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Remote State (via DataConnection)
  const [remoteStatus, setRemoteStatus] = useState<PeerStatus>({ isVideoEnabled: true, isAudioEnabled: true });
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  
  const [status, setStatus] = useState<'initializing' | 'idle' | 'calling' | 'connected'>('initializing');
  const [copied, setCopied] = useState(false);

  // Refs
  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);
  
  // Critical: Ref to hold stream for access inside closures (PeerJS callbacks)
  const localStreamRef = useRef<MediaStream | null>(null);

  // --- 1. Initialize Peer & Local Stream ---
  useEffect(() => {
    let peer: Peer;
    try {
      // Safe instantiation for ESM/CDN interop
      const PeerClass = (Peer as any).default || Peer;
      peer = new PeerClass();
    } catch (e) {
      console.error("PeerJS init failed", e);
      setError("Failed to initialize secure connection module.");
      return;
    }
    
    peer.on('open', (id) => {
      setPeerId(id);
      setStatus('idle');
    });

    peer.on('error', (err) => {
      console.error("PeerJS Error:", err);
      // Don't show critical error for transient network issues, but do for fatal ones
      if (err.type === 'unavailable-id' || err.type === 'invalid-id' || err.type === 'browser-incompatible') {
          setError(`Connection Error: ${err.type}`);
      }
    });

    // Handle incoming media calls
    peer.on('call', (call: MediaConnection) => {
      // Reuse the existing local stream if available
      const currentStream = localStreamRef.current;

      if (currentStream) {
        call.answer(currentStream);
        handleCallSetup(call);
      } else {
        // Fallback: If no stream exists yet, try to get it (rare race condition)
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
          .then((mediaStream) => {
            setStream(mediaStream);
            localStreamRef.current = mediaStream;
            if (myVideoRef.current) myVideoRef.current.srcObject = mediaStream;
            
            call.answer(mediaStream);
            handleCallSetup(call);
          })
          .catch(err => {
             console.error("Failed to get stream to answer call", err);
             setError("Could not access camera to answer call.");
          });
      }
    });

    // Handle incoming data connections (for status sync)
    peer.on('connection', (conn: DataConnection) => {
       setCurrentDataConn(conn);
       conn.on('data', (data: any) => {
          if (data && data.type === 'STATUS') {
             setRemoteStatus({ isVideoEnabled: data.video, isAudioEnabled: data.audio });
          }
       });
       conn.on('open', () => {
          // Send initial status back
          conn.send({ type: 'STATUS', video: !isVideoOff, audio: !isMuted });
       });
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Helper to setup call event listeners
  const handleCallSetup = (call: MediaConnection) => {
      setStatus('connected');
      
      call.on('stream', (remoteStream: MediaStream) => {
        setRemoteStream(remoteStream);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setupAudioAnalysis(remoteStream);
      });

      call.on('close', () => handleEndCall());
      call.on('error', (e: any) => console.error("Call error", e));
      setCurrentCall(call);
  };

  // Initialize Local Video Preview
  useEffect(() => {
    const initLocalVideo = async () => {
      try {
        // Mobile constraint: prefer front camera
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' }, 
            audio: true 
        });
        
        setStream(mediaStream);
        localStreamRef.current = mediaStream;
        
        if (myVideoRef.current) {
            myVideoRef.current.srcObject = mediaStream;
        }
        setError(null);
      } catch (err: any) {
        console.error("Failed local stream", err);
        if (err.name === 'NotAllowedError') {
            setError("Permission denied. Please allow camera and microphone access.");
        } else if (err.name === 'NotFoundError') {
            setError("No camera or microphone found.");
        } else if (err.name === 'NotReadableError') {
            setError("Camera is currently in use by another application.");
        } else {
            setError("Could not start video source.");
        }
      }
    };
    initLocalVideo();
    
    return () => {
      // Use ref to ensure we clean up the actual stream created in this effect
      if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Mirror effect binding
  useEffect(() => {
    if (myVideoRef.current && stream) {
        myVideoRef.current.srcObject = stream;
    }
  }, [stream, status]);

  // --- 2. Logic: Calls & Connections ---

  const initiateCall = (remoteId: string) => {
    // Check ref instead of state to be safe, though state should match
    const currentStream = localStreamRef.current;
    
    if (!peerRef.current || !currentStream) {
        setError("Cannot connect: Camera stream not active.");
        return;
    }
    
    setStatus('calling');
    
    // Media Call
    const call = peerRef.current.call(remoteId, currentStream);
    
    call.on('stream', (remoteStream: MediaStream) => {
      setRemoteStream(remoteStream);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      setupAudioAnalysis(remoteStream);
      setStatus('connected');
    });

    call.on('close', () => {
      handleEndCall();
    });
    
    call.on('error', (err: any) => {
        console.error("Call connection error", err);
        setError("Call connection failed.");
        setStatus('idle');
    });

    setCurrentCall(call);

    // Data Connection (for status)
    const conn = peerRef.current.connect(remoteId);
    conn.on('open', () => {
        conn.send({ type: 'STATUS', video: !isVideoOff, audio: !isMuted });
    });
    conn.on('data', (data: any) => {
        if (data && data.type === 'STATUS') {
            setRemoteStatus({ isVideoEnabled: data.video, isAudioEnabled: data.audio });
        }
    });
    setCurrentDataConn(conn);
  };

  const setupAudioAnalysis = (stream: MediaStream) => {
    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkAudio = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((a, b) => a + b, 0);
            const average = sum / bufferLength;
            // Threshold for "speaking"
            setIsRemoteSpeaking(average > 15); // Slightly increased threshold
            animationRef.current = requestAnimationFrame(checkAudio);
        };
        checkAudio();
    } catch (e) {
        console.error("Audio analysis setup failed", e);
    }
  };

  // --- 3. Logic: Toggles & Actions ---

  const sendStatusUpdate = (video: boolean, audio: boolean) => {
      if (currentDataConn && currentDataConn.open) {
          currentDataConn.send({ type: 'STATUS', video, audio });
      }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const newMutedState = !audioTrack.enabled; // Toggle
        audioTrack.enabled = newMutedState; // Actually flip
        const isNowMuted = !newMutedState; // If enabled=true, muted=false
        setIsMuted(isNowMuted);
        sendStatusUpdate(!isVideoOff, !isNowMuted);
      }
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const newVideoState = !videoTrack.enabled;
        videoTrack.enabled = newVideoState;
        const isNowVideoOff = !newVideoState;
        setIsVideoOff(isNowVideoOff);
        sendStatusUpdate(!isNowVideoOff, !isMuted);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: !isVideoOff, audio: true });
        replaceStream(newStream);
        setIsScreenSharing(false);
      } catch (e) {
        console.error("Failed revert to camera", e);
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        replaceStream(screenStream);
        setIsScreenSharing(true);
        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
      } catch (e) {
        console.error("Screen share cancelled", e);
      }
    }
  };

  const replaceStream = (newStream: MediaStream) => {
    // Stop old video tracks only
    if (stream) {
        stream.getVideoTracks().forEach(t => t.stop());
    }
    setStream(newStream);
    localStreamRef.current = newStream; // Update ref
    
    if (myVideoRef.current) myVideoRef.current.srcObject = newStream;
    
    if (currentCall && currentCall.peerConnection) {
        const videoTrack = newStream.getVideoTracks()[0];
        const senders = currentCall.peerConnection.getSenders();
        const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === 'video');
        if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);
    }
  };

  const handleEndCall = () => {
    currentCall?.close();
    currentDataConn?.close();
    setCurrentCall(null);
    setCurrentDataConn(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteStatus({ isVideoEnabled: true, isAudioEnabled: true });
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    onEndCall();
  };

  const copyId = () => {
    if (peerId) {
        navigator.clipboard.writeText(peerId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
  };

  const isConnected = status === 'connected' || status === 'calling';

  // --- RENDER ---

  if (status === 'initializing') {
      return (
          <div className="w-full h-full flex items-center justify-center bg-zinc-950 flex-col gap-4">
              <Loader2 className="animate-spin text-blue-600" size={32} />
              <div className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Initializing Secure Node...</div>
              {error && <div className="text-red-500 font-mono text-xs max-w-xs text-center">{error}</div>}
          </div>
      );
  }

  if (isConnected) {
    // IMMERSIVE MOBILE-FIRST CALL UI
    return (
      <div className="relative w-full h-full bg-zinc-950 overflow-hidden">
        
        {/* REMOTE VIDEO LAYER */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${!remoteStatus.isVideoEnabled ? 'opacity-0' : 'opacity-100'}`}>
             <video 
               ref={remoteVideoRef} 
               autoPlay 
               playsInline 
               className="w-full h-full object-cover" 
             />
        </div>

        {/* REMOTE OFF STATE PLACEHOLDER */}
        {!remoteStatus.isVideoEnabled && (
             <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-0">
                 <div className="flex flex-col items-center">
                     <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 border border-zinc-700">
                         <Eye size={32} className="text-zinc-500" />
                     </div>
                     <span className="text-zinc-500 font-mono tracking-widest text-sm">VIDEO PAUSED</span>
                 </div>
             </div>
        )}

        {/* SPEAKING INDICATOR (GLOW) */}
        {isRemoteSpeaking && (
            <div className="absolute inset-0 pointer-events-none border-4 border-blue-500/30 z-10 transition-all duration-200 shadow-[inset_0_0_100px_rgba(37,99,235,0.2)]"></div>
        )}

        {/* REMOTE STATUS INDICATORS */}
        <div className="absolute top-12 md:top-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
             {!remoteStatus.isAudioEnabled && (
                 <div className="px-3 py-1 bg-red-500/90 backdrop-blur rounded-full flex items-center gap-2 shadow-lg">
                     <MicOff size={12} className="text-white" />
                     <span className="text-[10px] font-bold text-white tracking-widest">MUTED</span>
                 </div>
             )}
             {isRemoteSpeaking && remoteStatus.isAudioEnabled && (
                 <div className="px-3 py-1 bg-blue-500/90 backdrop-blur rounded-full flex items-center gap-2 shadow-lg animate-pulse">
                     <Zap size={12} className="text-white fill-white" />
                     <span className="text-[10px] font-bold text-white tracking-widest">SPEAKING</span>
                 </div>
             )}
        </div>

        {/* LOCAL VIDEO PIP (MIRRORED) */}
        <div className="absolute top-4 right-4 w-28 md:w-56 aspect-[9/16] md:aspect-video bg-black border border-white/10 shadow-2xl z-30 overflow-hidden group">
             <video 
               ref={myVideoRef} 
               autoPlay 
               playsInline 
               muted 
               className={`w-full h-full object-cover mirror transition-opacity duration-300 ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} 
             />
             <div className="absolute inset-0 bg-black flex items-center justify-center -z-10">
                 <CameraOff size={20} className="text-zinc-700" />
             </div>
             {/* Pip Status */}
             <div className="absolute bottom-1 right-1 flex gap-1">
                 {isMuted && <div className="p-1 bg-red-500 rounded"><MicOff size={8} className="text-white" /></div>}
             </div>
        </div>

        {/* BOTTOM CONTROLS */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 md:gap-6 p-3 md:p-4 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl z-40 shadow-2xl">
            <button onClick={toggleAudio} className={`p-4 rounded-xl transition-all active:scale-95 ${isMuted ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button onClick={toggleVideo} className={`p-4 rounded-xl transition-all active:scale-95 ${isVideoOff ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                {isVideoOff ? <CameraOff size={24} /> : <Camera size={24} />}
            </button>
            <button onClick={toggleScreenShare} className={`hidden md:block p-4 rounded-xl transition-all active:scale-95 ${isScreenSharing ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
            </button>
            <div className="w-[1px] h-8 bg-zinc-700 mx-1"></div>
            <button onClick={handleEndCall} className="p-4 rounded-xl bg-red-600 text-white hover:bg-red-500 transition-all active:scale-95 shadow-lg">
                <PhoneOff size={24} />
            </button>
        </div>
      </div>
    );
  }

  // DASHBOARD LAYOUT (IDLE)
  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:grid-rows-6 p-0 gap-[1px] auto-rows-fr">
      
      {/* Identity Card */}
      <div className="bento-cell col-span-1 row-span-2 md:row-span-6 p-6 md:p-8 flex flex-col justify-center relative overflow-hidden min-h-[300px]">
        <div className="absolute top-0 right-0 p-4 opacity-5">
            <UserPlus size={150} />
        </div>
        <div className="relative z-10">
            <h2 className="text-xs text-blue-500 font-bold font-mono mb-6 uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                Your Digital ID
            </h2>
            <div className="mb-8">
                <div className="text-3xl md:text-5xl font-thin text-white mb-2 break-all tracking-tighter leading-none">
                    {peerId ? peerId.substring(0, 6) : '......'}
                    <span className="text-zinc-800">{peerId ? peerId.substring(6) : ''}</span>
                </div>
            </div>
            
            <div className="flex flex-col gap-3">
                <Button variant="secondary" onClick={copyId} className="w-full justify-between group h-14">
                    <span className="text-xs font-mono">{copied ? 'COPIED TO CLIPBOARD' : 'COPY SECURE ID'}</span>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-zinc-500 group-hover:text-white transition-colors"/>}
                </Button>
            </div>
        </div>
      </div>

      {/* Connect Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 p-6 md:p-8 flex flex-col justify-center bg-zinc-950 min-h-[250px]">
         <h2 className="text-xs text-zinc-500 font-bold font-mono mb-6 uppercase tracking-widest">Establish Link</h2>
         <div className="flex flex-col gap-4 max-w-lg w-full">
             <div className="relative group">
                 <input 
                    type="text" 
                    placeholder="ENTER REMOTE ID..."
                    className="w-full bg-black border-b border-zinc-800 p-6 text-white font-mono placeholder:text-zinc-800 focus:border-blue-600 focus:outline-none transition-colors text-xl md:text-2xl"
                    value={remotePeerIdValue}
                    onChange={e => setRemotePeerIdValue(e.target.value)}
                 />
                 <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-blue-600 transition-colors">
                    <Signal size={20} />
                 </div>
             </div>
             <Button 
                variant="primary" 
                size="lg" 
                className="w-full py-6 mt-4"
                onClick={() => initiateCall(remotePeerIdValue)} 
                disabled={!remotePeerIdValue || !peerId}
            >
                Connect System
             </Button>
         </div>
      </div>

      {/* Local Preview Card (Idle) */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 relative group overflow-hidden bg-black min-h-[250px]">
         <video 
            ref={myVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className={`w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-700 mirror ${isVideoOff ? 'hidden' : 'block'}`} 
         />
         
         {/* Error Overlay */}
         {error && (
             <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 z-20">
                 <div className="flex flex-col items-center text-center">
                    <AlertCircle size={32} className="text-red-500 mb-2" />
                    <span className="text-red-500 font-mono text-xs">{error}</span>
                 </div>
             </div>
         )}
         
         {/* Overlay Grid */}
         <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

         <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             {isVideoOff && !error ? (
                 <div className="flex flex-col items-center gap-4 text-zinc-800">
                     <CameraOff size={48} strokeWidth={1} />
                     <span className="font-mono text-xs tracking-widest">SIGNAL LOST</span>
                 </div>
             ) : (
                 !error && <div className="text-white/10 font-thin text-6xl tracking-tighter uppercase select-none">Preview</div>
             )}
         </div>

         {/* Mini Controls for Preview */}
         <div className="absolute bottom-6 right-6 flex gap-2 z-20">
            <button onClick={toggleVideo} className="p-3 bg-black/50 border border-white/10 text-white hover:bg-white hover:text-black transition-colors backdrop-blur-md">
                {isVideoOff ? <CameraOff size={18} /> : <Camera size={18} />}
            </button>
            <button onClick={toggleAudio} className="p-3 bg-black/50 border border-white/10 text-white hover:bg-white hover:text-black transition-colors backdrop-blur-md">
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
         </div>
      </div>
    </div>
  );
};