import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { Button } from './Button';
import { 
  Camera, CameraOff, Mic, MicOff, PhoneOff, 
  Copy, ArrowRight, Check, Eye, Loader2,
  AlertCircle, ShieldCheck, Lock, Fingerprint, RefreshCcw, User, Zap
} from 'lucide-react';
import { SecureProtocolService } from '../services/secureProtocolService';
import { TurnService } from '../services/turnService';
import { CryptoIdentity, EphemeralKeys, SecurityContext, HandshakePayload } from '../types';

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
  const [isVideoOff, setIsVideoOff] = useState(true); // Default to VOICE ONLY (Camera Off)
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Remote State (via DataConnection)
  const [remoteStatus, setRemoteStatus] = useState<PeerStatus>({ isVideoEnabled: true, isAudioEnabled: true });
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  
  const [status, setStatus] = useState<'initializing' | 'idle' | 'calling' | 'connected'>('initializing');
  const [copied, setCopied] = useState(false);

  // --- TIMER STATE ---
  const [callDuration, setCallDuration] = useState(0);

  // --- SECURITY STATE ---
  const [identity, setIdentity] = useState<CryptoIdentity | null>(null);
  const [securityContext, setSecurityContext] = useState<SecurityContext | null>(null);
  const [showFingerprint, setShowFingerprint] = useState(false);

  // Refs
  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const ephemeralKeysRef = useRef<EphemeralKeys | null>(null); // Per-session keys
  const rotationIntervalRef = useRef<any>(null);
  const isRequestingStream = useRef(false);

  // --- HELPER: STOP STREAM ---
  const stopLocalStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setStream(null);
    }
  };

  // --- 1. Initialize Peer, Crypto Identity & Local Stream ---
  useEffect(() => {
    const initSystem = async () => {
      // 1. Load/Generate Identity
      const id = await SecureProtocolService.getOrCreateIdentity();
      setIdentity(id);

      // 2. Fetch ICE Servers (TURN/STUN)
      const tempId = Math.random().toString(36).substring(7);
      const iceServers = await TurnService.getIceServers(tempId);

      // 3. Initialize PeerJS
      let peer: Peer;
      try {
        const PeerClass = (Peer as any).default || Peer;
        peer = new PeerClass(undefined, {
          debug: 1, // Reduced debug level
          secure: true, // Force secure connection for Vercel/HTTPS
          pingInterval: 5000, // Keep socket alive on mobile
          config: {
            iceServers: iceServers, // DYNAMICALLY LOADED SERVERS
            iceCandidatePoolSize: 10,
          }
        });
      } catch (e) {
        console.error("PeerJS init failed", e);
        setError("Failed to initialize secure connection module.");
        return;
      }
      
      peer.on('open', (id: string) => {
        console.log("Connected to Signaling Server. ID:", id);
        setPeerId(id);
        setStatus('idle');
        setError(null);
      });

      // --- CRITICAL: AUTO RECONNECT ---
      peer.on('disconnected', () => {
        console.warn("PeerJS: Disconnected from signaling server. Reconnecting...");
        if (peer && !peer.destroyed) {
            setTimeout(() => {
                if (peer && !peer.destroyed) peer.reconnect();
            }, 1000);
        }
      });

      peer.on('close', () => {
        console.warn("PeerJS: Connection closed permanently.");
        setStatus('idle');
      });

      peer.on('error', (err: any) => {
        console.error("PeerJS Error:", err);
        if (err.type === 'network' || err.message?.includes('Lost connection')) {
             console.log("Transient network error. Attempting recovery...");
             return; 
        }

        if (err.type === 'peer-unavailable') {
            setError(`User "${remotePeerIdValue}" is unreachable. Check the ID.`);
            setStatus('idle');
        } else if (err.type === 'unavailable-id' || err.type === 'invalid-id' || err.type === 'browser-incompatible') {
            setError(`Connection Error: ${err.type}`);
        }
      });

      peer.on('call', (call: MediaConnection) => {
        if (currentCall) {
            call.close();
            return;
        }

        const answerCall = (streamToUse: MediaStream) => {
             call.answer(streamToUse);
             handleCallSetup(call);
        };

        const currentStream = localStreamRef.current;
        if (currentStream && currentStream.active) {
          answerCall(currentStream);
        } else {
          getMobileFriendlyStream()
            .then((mediaStream) => {
              setStream(mediaStream);
              localStreamRef.current = mediaStream;
              // Ensure track state matches UI state immediately on answer
              mediaStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
              answerCall(mediaStream);
            })
            .catch(err => {
               console.error("Failed to get stream to answer call", err);
               setError("Could not access camera to answer call.");
            });
        }
      });

      peer.on('connection', (conn: DataConnection) => {
         setCurrentDataConn(conn);
         setupSecureDataConnection(conn, id); 
      });

      peerRef.current = peer;
    };

    initSystem();

    return () => {
      peerRef.current?.destroy();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);
    };
  }, []);

  // --- TIMER LOGIC ---
  useEffect(() => {
    let interval: any;
    if (status === 'connected') {
      const startTime = Date.now();
      setCallDuration(0);
      interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [status]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    
    if (hrs > 0) {
      return `${hrs}:${(mins % 60).toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const setupSecureDataConnection = async (conn: DataConnection, currentIdentity: CryptoIdentity) => {
      const ephKeys = await SecureProtocolService.generateEphemeralKeys();
      ephemeralKeysRef.current = ephKeys;

      conn.on('open', async () => {
          const payload = await SecureProtocolService.createHandshakePayload(
            currentIdentity,
            ephKeys,
            'SECURE_HANDSHAKE_INIT'
          );
          if (conn.open) {
            conn.send(payload);
            conn.send({ type: 'STATUS', video: !isVideoOff, audio: !isMuted });
          }
      });

      conn.on('data', async (data: any) => {
          if (
              data.type === 'SECURE_HANDSHAKE_INIT' || 
              data.type === 'SECURE_HANDSHAKE_RESP' ||
              data.type === 'SECURE_KEY_ROTATION'
          ) {
             if (!ephemeralKeysRef.current) return;
             
             const result = await SecureProtocolService.verifyAndDeriveSession(
                currentIdentity,
                ephemeralKeysRef.current,
                data as HandshakePayload
             );

             if (result) {
               setSecurityContext(prev => ({
                 isVerified: true,
                 safetyFingerprint: result.sessionFingerprint,
                 remoteIdentityFingerprint: result.remoteIdentityFingerprint,
                 lastRotation: Date.now()
               }));
               
               if (data.type === 'SECURE_HANDSHAKE_INIT') {
                  const respPayload = await SecureProtocolService.createHandshakePayload(
                    currentIdentity,
                    ephemeralKeysRef.current!,
                    'SECURE_HANDSHAKE_RESP'
                  );
                  if (conn.open) conn.send(respPayload);
               }
             } else {
               setError("SECURITY ALERT: Verification Failed.");
               conn.close();
             }
          }

          if (data.type === 'STATUS') {
             setRemoteStatus({ isVideoEnabled: data.video, isAudioEnabled: data.audio });
          }
      });

      conn.on('error', (err: any) => console.error("Data connection error", err));
  };

  useEffect(() => {
    if (status === 'connected' && securityContext?.isVerified && currentDataConn?.open && identity) {
      if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);

      rotationIntervalRef.current = setInterval(async () => {
        try {
          if (!currentDataConn.open) {
             console.warn("Skipping rotation: Connection closed");
             return;
          }
          const newKeys = await SecureProtocolService.generateEphemeralKeys();
          ephemeralKeysRef.current = newKeys;

          const payload = await SecureProtocolService.createHandshakePayload(
            identity,
            newKeys,
            'SECURE_KEY_ROTATION'
          );

          currentDataConn.send(payload);
          setSecurityContext(prev => prev ? ({ ...prev, lastRotation: Date.now() }) : null);
        } catch (e) {
          console.error("Key rotation failed", e);
        }
      }, 60000); 
    }

    return () => {
      if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);
    };
  }, [status, securityContext?.isVerified, currentDataConn, identity]);

  const handleCallSetup = (call: MediaConnection) => {
      setStatus('connected');
      call.on('stream', (rStream: MediaStream) => {
        setRemoteStream(rStream);
        setupAudioAnalysis(rStream);
      });
      call.on('close', () => handleEndCall());
      call.on('error', (e: any) => {
          console.error("Call error", e);
          if (status === 'connected') setError("Call connection interrupted.");
      });
      setCurrentCall(call);
  };

  useEffect(() => {
    if (myVideoRef.current && stream) {
        myVideoRef.current.srcObject = stream;
        myVideoRef.current.play().catch(e => console.log("Local play error:", e));
    }
  }, [stream, status, isVideoOff]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(e => console.error("Remote video play error:", e));
    }
  }, [remoteStream, status]);


  const getMobileFriendlyStream = async (): Promise<MediaStream> => {
     try {
       stopLocalStream();
       return await navigator.mediaDevices.getUserMedia({ 
           video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, 
           audio: true 
       });
     } catch (err) {
       console.warn("Specific constraints failed.", err);
       await new Promise(resolve => setTimeout(resolve, 500));
       return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
     }
  };

  useEffect(() => {
    const initLocalVideo = async () => {
      if (localStreamRef.current || isRequestingStream.current) return;
      isRequestingStream.current = true;
      
      try {
        const mediaStream = await getMobileFriendlyStream();
        setStream(mediaStream);
        localStreamRef.current = mediaStream;
        
        // --- SYNC WITH DEFAULT UI STATE ---
        // If isVideoOff is true by default, disable track immediately
        mediaStream.getVideoTracks().forEach(track => {
            track.enabled = !isVideoOff;
        });
        
        setError(null);
      } catch (err: any) {
        console.error("Failed local stream", err);
        if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
             setError("Camera is in use by another app. Please close other tabs/apps and reload.");
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
             setError("Camera permission denied. Please enable access in browser settings.");
        } else {
             setError(`Camera Error: ${err.message || 'Unknown error'}`);
        }
      } finally {
        isRequestingStream.current = false;
      }
    };
    
    initLocalVideo();
    return () => {};
  }, []); // Run once on mount

  const initiateCall = (remoteId: string) => {
    const currentStream = localStreamRef.current;
    if (!peerRef.current || !currentStream || !identity) {
        if (!currentStream) setError("Camera not ready. Cannot start call.");
        return;
    }
    if (!remoteId) {
        setError("Please enter a valid remote ID.");
        return;
    }
    setError(null);
    setStatus('calling');
    
    try {
        const call = peerRef.current.call(remoteId, currentStream);
        handleCallSetup(call);
        
        const conn = peerRef.current.connect(remoteId);
        setupSecureDataConnection(conn, identity);
        setCurrentDataConn(conn);
    } catch(e: any) {
        console.error("Initiate call error:", e);
        setError("Failed to start connection sequence.");
        setStatus('idle');
    }
  };

  const setupAudioAnalysis = (stream: MediaStream) => {
    try {
        if (analyserRef.current) return;
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
            if (audioContextRef.current?.state === 'suspended') {
                audioContextRef.current.resume();
            }
            analyserRef.current.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((a, b) => a + b, 0);
            const average = sum / bufferLength;
            setIsRemoteSpeaking(average > 10);
            animationRef.current = requestAnimationFrame(checkAudio);
        };
        checkAudio();
    } catch (e) {
        console.error("Audio analysis setup failed", e);
    }
  };

  const sendStatusUpdate = (video: boolean, audio: boolean) => {
      if (currentDataConn && currentDataConn.open) {
          currentDataConn.send({ type: 'STATUS', video, audio });
      }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        sendStatusUpdate(!isVideoOff, audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        sendStatusUpdate(videoTrack.enabled, !isMuted);
      }
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
    setSecurityContext(null);
    setShowFingerprint(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);
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

  if (status === 'initializing') {
      return (
          <div className="w-full h-full flex items-center justify-center bg-zinc-950 flex-col gap-4">
              <Loader2 className="animate-spin text-blue-600" size={32} />
              <div className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Booting Talkr Node...</div>
          </div>
      );
  }

  if (isConnected) {
    return (
      <div className="relative w-full h-full bg-zinc-950 overflow-hidden">
        
        {/* REMOTE VIDEO */}
        <div className={`absolute inset-0 transition-opacity duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] ${!remoteStatus.isVideoEnabled ? 'opacity-0' : 'opacity-100'}`}>
             <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        </div>

        {/* REMOTE OFF STATE (VOICE VISUALIZER) */}
        <div className={`absolute inset-0 flex items-center justify-center bg-zinc-900 z-0 transition-opacity duration-700 ${!remoteStatus.isVideoEnabled ? 'opacity-100' : 'opacity-0'}`}>
             <div className="flex flex-col items-center">
                 <div className={`w-32 h-32 rounded-full border border-zinc-700 flex items-center justify-center mb-6 relative ${isRemoteSpeaking ? 'shadow-[0_0_100px_rgba(37,99,235,0.3)] bg-zinc-800' : 'bg-zinc-900'}`}>
                     <div className={`absolute inset-0 rounded-full bg-blue-600/20 transition-all duration-100 ${isRemoteSpeaking ? 'scale-125 opacity-100' : 'scale-100 opacity-0'}`}></div>
                     {isRemoteSpeaking ? <Zap size={40} className="text-blue-500 fill-blue-500" /> : <User size={40} className="text-zinc-600" />}
                 </div>
                 <span className="text-zinc-500 font-mono tracking-widest text-sm uppercase">Voice Link Active</span>
             </div>
        </div>
        
        {/* SECURITY BADGE OVERLAY */}
        <div className="absolute top-6 left-6 z-20 flex flex-col gap-2">
           <div 
             className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md border ${securityContext?.isVerified ? 'bg-black/80 border-green-500/50 text-green-400' : 'bg-black/80 border-yellow-500/50 text-yellow-400'} cursor-pointer hover:bg-zinc-900 transition-colors shadow-lg`}
             onClick={() => setShowFingerprint(!showFingerprint)}
           >
              {securityContext?.isVerified ? <ShieldCheck size={16} /> : <Lock size={16} className="animate-pulse"/>}
              <span className="text-[10px] font-mono font-bold tracking-widest uppercase">
                {securityContext?.isVerified ? 'ENCRYPTED' : 'HANDSHAKE...'}
              </span>
           </div>

           {securityContext?.lastRotation && (
             <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-white/10 backdrop-blur-md text-zinc-500 animate-in fade-in slide-in-from-left-2">
                <RefreshCcw size={10} />
                <span className="text-[9px] font-mono tracking-wider">
                  ROTATED {Math.floor((Date.now() - securityContext.lastRotation) / 1000)}s AGO
                </span>
             </div>
           )}

           {showFingerprint && securityContext && (
             <div className="mt-2 p-5 bg-black border border-zinc-800 rounded-none shadow-2xl max-w-xs animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 mb-4 text-zinc-500">
                  <Fingerprint size={16} />
                  <span className="text-xs font-mono uppercase tracking-widest">Verification Key</span>
                </div>
                <div className="grid grid-cols-4 gap-2 font-mono text-xl text-white tracking-tighter mb-4">
                  {securityContext.safetyFingerprint.split(' ').map((block, i) => (
                    <span key={i} className="bg-zinc-900 p-1 text-center border border-zinc-800">{block}</span>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-600 leading-relaxed uppercase">
                  Compare this key with your peer to verify integrity.
                </div>
             </div>
           )}
        </div>

        {/* PIP - LOCAL VIDEO with SWEET ANIMATION */}
        <div className={`absolute top-4 right-4 w-28 md:w-48 aspect-[9/16] bg-black border border-zinc-800 rounded-2xl shadow-2xl z-30 overflow-hidden group transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-top-right ${isVideoOff ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}>
             <video ref={myVideoRef} autoPlay playsInline muted className="w-full h-full object-cover mirror" />
        </div>

        {/* CALL TIMER - REPOSITIONED BOTTOM */}
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 px-4 py-1 rounded-full bg-black/40 border border-white/5 backdrop-blur-md flex items-center gap-3 opacity-40 hover:opacity-100 transition-opacity duration-300">
            <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
            <span className="text-sm font-mono tracking-widest text-white/90">
                {formatDuration(callDuration)}
            </span>
        </div>

        {/* CONTROLS - FLOATING ISLAND */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 p-4 md:p-6 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-full z-40 shadow-2xl mb-8 safe-pb">
            <button 
                onClick={toggleAudio} 
                className={`p-4 rounded-full transition-all active:scale-95 shadow-md ${isMuted ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-black hover:bg-zinc-200'}`}
                title={isMuted ? "Unmute" : "Mute"}
            >
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button 
                onClick={toggleVideo} 
                className={`p-4 rounded-full transition-all active:scale-95 shadow-md ${isVideoOff ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-black hover:bg-zinc-200'}`}
                title={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
            >
                {isVideoOff ? <CameraOff size={24} /> : <Camera size={24} />}
            </button>
            <div className="w-px h-8 bg-white/20 mx-2"></div>
            <button 
                onClick={handleEndCall} 
                className="p-4 rounded-full bg-red-600 text-white hover:bg-red-500 transition-all active:scale-95 shadow-lg"
                title="End Call"
            >
                <PhoneOff size={24} />
            </button>
        </div>
      </div>
    );
  }

  // DASHBOARD - BENTO GRID LAYOUT
  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:grid-rows-6 p-4 gap-4 auto-rows-fr">
      
      {/* Identity Card */}
      <div className="bento-cell col-span-1 row-span-2 md:row-span-6 p-8 md:p-12 flex flex-col justify-center relative overflow-hidden min-h-[300px] rounded-3xl border border-zinc-800">
        <div className="absolute -top-10 -right-10 p-0 opacity-[0.03]"><User size={400} /></div>
        <div className="relative z-10 flex flex-col h-full justify-center">
            <h2 className="text-xs text-blue-600 font-bold font-mono mb-8 uppercase tracking-[0.2em] flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                My Signal
            </h2>
            
            <div className="mb-4">
                <div className="text-2xl md:text-4xl font-black text-white mb-2 break-all tracking-tighter leading-tight">
                    {peerId ? peerId.substring(0, 6) : '......'}
                    <span className="text-zinc-800">{peerId ? peerId.substring(6) : ''}</span>
                </div>
            </div>
            
            {identity && (
              <div className="mb-10 flex items-center gap-4 select-text">
                 <Fingerprint size={36} strokeWidth={1} className="text-zinc-700 shrink-0"/>
                 <div className="flex flex-col gap-1">
                   <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-[0.2em]">Public Key Hash</span>
                   <span className="text-lg md:text-xl text-blue-500 font-mono tracking-widest leading-none">{identity.publicKeyFingerprint}</span>
                 </div>
              </div>
            )}
            
            <div className="mt-auto">
                <Button variant="secondary" onClick={copyId} className="w-full justify-between group h-16 border-zinc-800 hover:border-white hover:bg-white hover:text-black transition-all rounded-full">
                    <span className="text-sm font-mono tracking-widest uppercase pl-2">{copied ? 'COPIED TO CLIPBOARD' : 'COPY ID'}</span>
                    {copied ? <Check size={20} className="text-green-600" /> : <Copy size={20} className="text-zinc-500 group-hover:text-black"/>}
                </Button>
            </div>
        </div>
      </div>

      {/* Connect Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 p-8 md:p-12 flex flex-col justify-center bg-zinc-950 min-h-[300px] rounded-3xl border border-zinc-800">
         <h2 className="text-xs text-zinc-600 font-bold font-mono mb-8 uppercase tracking-[0.2em]">Dial</h2>
         <div className="flex flex-col gap-0 max-w-2xl w-full">
             <div className="relative group">
                 <input 
                    type="text" 
                    placeholder="ENTER ID"
                    className="w-full bg-transparent border-b-2 border-zinc-800 py-6 text-white font-black placeholder:text-zinc-900 focus:border-blue-600 focus:outline-none transition-colors text-4xl md:text-6xl tracking-tighter uppercase rounded-none"
                    value={remotePeerIdValue}
                    onChange={e => setRemotePeerIdValue(e.target.value)}
                 />
             </div>
             <div className="flex justify-end mt-8">
                <Button 
                    variant="primary" 
                    size="lg" 
                    className="py-6 px-8 bg-blue-600 border-blue-600 hover:bg-blue-500 hover:border-blue-500 text-white w-auto flex gap-4 items-center group disabled:opacity-50 disabled:cursor-not-allowed rounded-full"
                    onClick={() => initiateCall(remotePeerIdValue)} 
                    disabled={!remotePeerIdValue || !peerId}
                >
                    <span className="tracking-widest font-bold">CONNECT</span>
                    <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </Button>
             </div>
         </div>
      </div>

      {/* Local Preview Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 relative group overflow-hidden bg-black min-h-[250px] rounded-3xl border border-zinc-800">
         {/* Animated Preview Container */}
         <div className={`w-full h-full transition-opacity duration-500 ${isVideoOff ? 'opacity-0' : 'opacity-50 group-hover:opacity-80'}`}>
            <video ref={myVideoRef} autoPlay playsInline muted className="w-full h-full object-cover mirror rounded-3xl" />
         </div>

         {error && (
             <div className="absolute inset-0 bg-black/90 flex items-center justify-center p-8 z-20 rounded-3xl">
                 <div className="flex flex-col items-center text-center">
                    <AlertCircle size={40} className="text-red-600 mb-4" />
                    <span className="text-red-500 font-mono text-xs uppercase tracking-widest max-w-md leading-relaxed">{error}</span>
                    {error.includes("use") && <Button variant="ghost" onClick={() => window.location.reload()} className="mt-6 border border-zinc-800 text-zinc-400 rounded-full">System Reload</Button>}
                 </div>
             </div>
         )}
         
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             {isVideoOff && !error ? (
                 <div className="flex flex-col items-center gap-6 text-zinc-800 animate-in fade-in zoom-in duration-500">
                     <CameraOff size={64} strokeWidth={1} />
                     <span className="font-mono text-xs tracking-[0.3em] uppercase">Camera Disabled</span>
                 </div>
             ) : (
                 !error && <div className="text-white/5 font-black text-8xl tracking-tighter uppercase select-none">Preview</div>
             )}
         </div>

         <div className="absolute bottom-8 right-8 flex gap-3 z-20">
            <button onClick={toggleVideo} className={`p-4 border text-white transition-all rounded-full ${isVideoOff ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800' : 'bg-black border-zinc-800 hover:bg-white hover:text-black'}`}>
                {isVideoOff ? <CameraOff size={20} /> : <Camera size={20} />}
            </button>
            <button onClick={toggleAudio} className={`p-4 border text-white transition-all rounded-full ${isMuted ? 'bg-red-900/20 border-red-900 text-red-500' : 'bg-black border-zinc-800 hover:bg-white hover:text-black'}`}>
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
         </div>
      </div>
    </div>
  );
};