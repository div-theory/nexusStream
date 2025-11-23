import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { Button } from './Button';
import { 
  Camera, CameraOff, Mic, MicOff, Monitor, PhoneOff, 
  Copy, Signal, MonitorOff, UserPlus, Zap, Check, Eye, Loader2,
  AlertCircle, Shield, ShieldCheck, Lock, Fingerprint, RefreshCcw
} from 'lucide-react';
import { SecureProtocolService } from '../services/secureProtocolService';
import { TurnService } from '../services/turnService'; // NEW IMPORT
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
  const [isVideoOff, setIsVideoOff] = useState(false);
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
      // Generates a random temp ID for fetching creds if needed before we have a real Peer ID
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
        // Auto-reconnect if not destroyed
        if (peer && !peer.destroyed) {
            // Short timeout to allow network to stabilize
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
        // Handle "Lost connection to server" gracefully
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
        // Fix: If we are already in a call, reject or handle appropriately
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
          // Fallback if no local stream yet
          getMobileFriendlyStream()
            .then((mediaStream) => {
              setStream(mediaStream);
              localStreamRef.current = mediaStream;
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
         setupSecureDataConnection(conn, id); // Pass identity
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
      // 1. Generate Initial Ephemeral Keys
      const ephKeys = await SecureProtocolService.generateEphemeralKeys();
      ephemeralKeysRef.current = ephKeys;

      conn.on('open', async () => {
          // 2. Initiate Secure Handshake
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
          // --- HANDSHAKE & ROTATION HANDLER ---
          if (
              data.type === 'SECURE_HANDSHAKE_INIT' || 
              data.type === 'SECURE_HANDSHAKE_RESP' ||
              data.type === 'SECURE_KEY_ROTATION'
          ) {
             if (!ephemeralKeysRef.current) return;
             
             // Verify the signature and re-derive shared secret
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
                 lastRotation: Date.now() // Update timestamp on rotation
               }));
               
               // If INIT, send RESP to complete handshake
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

          // --- STATUS HANDLER ---
          if (data.type === 'STATUS') {
             setRemoteStatus({ isVideoEnabled: data.video, isAudioEnabled: data.audio });
          }
      });

      conn.on('error', (err: any) => console.error("Data connection error", err));
  };

  // --- KEY ROTATION LOGIC ---
  useEffect(() => {
    // Start rotation timer only if we are connected and verified
    if (status === 'connected' && securityContext?.isVerified && currentDataConn?.open && identity) {
      if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);

      rotationIntervalRef.current = setInterval(async () => {
        try {
          if (!currentDataConn.open) {
             console.warn("Skipping rotation: Connection closed");
             return;
          }

          // 1. Generate NEW Ephemeral Keys
          const newKeys = await SecureProtocolService.generateEphemeralKeys();
          ephemeralKeysRef.current = newKeys;

          // 2. Create Rotation Payload (Signed by Long-term Identity)
          const payload = await SecureProtocolService.createHandshakePayload(
            identity,
            newKeys,
            'SECURE_KEY_ROTATION'
          );

          // 3. Send
          currentDataConn.send(payload);
          
          // 4. Update UI to show we initiated rotation
          setSecurityContext(prev => prev ? ({ ...prev, lastRotation: Date.now() }) : null);
          console.log("Keys rotated securely.");
        } catch (e) {
          console.error("Key rotation failed", e);
        }
      }, 60000); // 60 seconds
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
          // Only show error if call wasn't manually ended
          if (status === 'connected') setError("Call connection interrupted.");
      });
      setCurrentCall(call);
  };

  // --- STREAM ATTACHMENT EFFECT ---
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


  // Robust Helper for Mobile Streams with Delay
  const getMobileFriendlyStream = async (): Promise<MediaStream> => {
     try {
       // Stop any existing tracks first
       stopLocalStream();
       
       // Try specific mobile constraints first
       console.log("Requesting camera: User facing mode...");
       return await navigator.mediaDevices.getUserMedia({ 
           video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, 
           audio: true 
       });
     } catch (err) {
       console.warn("Specific constraints failed.", err);
       
       // CRITICAL FIX: Wait 500ms to allow hardware to release the failed request
       await new Promise(resolve => setTimeout(resolve, 500));

       console.log("Retrying with generic constraints...");
       return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
     }
  };

  // Initialize Local Video Preview
  useEffect(() => {
    const initLocalVideo = async () => {
      // If we already have a stream, don't request again
      if (localStreamRef.current || isRequestingStream.current) return;
      
      isRequestingStream.current = true;
      
      try {
        const mediaStream = await getMobileFriendlyStream();
        setStream(mediaStream);
        localStreamRef.current = mediaStream;
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
    
    return () => {
      // Don't stop stream on simple re-renders, only if component truly unmounts
      // stopLocalStream(); 
    };
  }, []);

  // --- LOGIC ---

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

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: !isVideoOff, audio: true });
        replaceStream(newStream);
        setIsScreenSharing(false);
      } catch (e) { console.error(e); }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        replaceStream(screenStream);
        setIsScreenSharing(true);
        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
      } catch (e) { console.error(e); }
    }
  };

  const replaceStream = (newStream: MediaStream) => {
    if (stream) stream.getVideoTracks().forEach(t => t.stop());
    setStream(newStream);
    localStreamRef.current = newStream;
    if (currentCall && currentCall.peerConnection) {
        const senders = currentCall.peerConnection.getSenders();
        const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === 'video');
        if (videoSender) videoSender.replaceTrack(newStream.getVideoTracks()[0]);
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
    setSecurityContext(null); // Reset security context
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

  // --- RENDER ---

  const isConnected = status === 'connected' || status === 'calling';

  if (status === 'initializing') {
      return (
          <div className="w-full h-full flex items-center justify-center bg-zinc-950 flex-col gap-4">
              <Loader2 className="animate-spin text-blue-600" size={32} />
              <div className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Initializing Secure Node...</div>
          </div>
      );
  }

  if (isConnected) {
    return (
      <div className="relative w-full h-full bg-zinc-950 overflow-hidden">
        
        {/* REMOTE VIDEO */}
        <div className={`absolute inset-0 transition-opacity duration-300 ${!remoteStatus.isVideoEnabled ? 'opacity-0' : 'opacity-100'}`}>
             <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        </div>

        {/* REMOTE OFF STATE */}
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
        
        {/* CALL TIMER - CENTERED TOP */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-black/40 border border-white/5 backdrop-blur-md flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-mono tracking-widest text-white/90">
                {formatDuration(callDuration)}
            </span>
        </div>

        {/* SECURITY BADGE OVERLAY */}
        <div className="absolute top-6 left-6 z-20 flex flex-col gap-2">
           <div 
             className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border ${securityContext?.isVerified ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'} cursor-pointer hover:bg-black/80 transition-colors`}
             onClick={() => setShowFingerprint(!showFingerprint)}
           >
              {securityContext?.isVerified ? <ShieldCheck size={14} /> : <Lock size={14} className="animate-pulse"/>}
              <span className="text-[10px] font-mono font-bold tracking-widest uppercase">
                {securityContext?.isVerified ? 'E2EE VERIFIED' : 'VERIFYING...'}
              </span>
           </div>

           {/* KEY ROTATION INDICATOR */}
           {securityContext?.lastRotation && (
             <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/40 border border-white/5 backdrop-blur-md text-zinc-400 animate-in fade-in slide-in-from-left-2">
                <RefreshCcw size={10} />
                <span className="text-[9px] font-mono tracking-wider">
                  KEYS ROTATED {Math.floor((Date.now() - securityContext.lastRotation) / 1000)}s AGO
                </span>
             </div>
           )}

           {/* FINGERPRINT MODAL / POPUP */}
           {showFingerprint && securityContext && (
             <div className="mt-2 p-4 bg-black/90 border border-white/10 backdrop-blur-xl rounded-lg shadow-2xl max-w-xs animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 mb-3 text-zinc-400">
                  <Fingerprint size={16} />
                  <span className="text-xs font-mono uppercase tracking-widest">Safety Number</span>
                </div>
                <div className="grid grid-cols-4 gap-2 font-mono text-xl md:text-2xl text-white tracking-tighter mb-4">
                  {securityContext.safetyFingerprint.split(' ').map((block, i) => (
                    <span key={i} className="bg-white/5 p-1 rounded text-center">{block}</span>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-500 leading-relaxed">
                  Verify this number matches on your friend's device to ensure no intruders.
                </div>
             </div>
           )}
        </div>

        {/* PIP */}
        <div className="absolute top-4 right-4 w-28 md:w-56 aspect-[9/16] md:aspect-video bg-black border border-white/10 shadow-2xl z-30 overflow-hidden group">
             <video ref={myVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover mirror transition-opacity duration-300 ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
             <div className="absolute inset-0 bg-black flex items-center justify-center -z-10"><CameraOff size={20} className="text-zinc-700" /></div>
        </div>

        {/* CONTROLS */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 md:gap-6 p-3 md:p-4 bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl z-40 shadow-2xl safe-pb">
            <button onClick={toggleAudio} className={`p-4 rounded-xl transition-all active:scale-95 ${isMuted ? 'bg-red-500 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button onClick={toggleVideo} className={`p-4 rounded-xl transition-all active:scale-95 ${isVideoOff ? 'bg-red-500 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
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

  // DASHBOARD
  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:grid-rows-6 p-0 gap-[1px] auto-rows-fr">
      
      {/* Identity Card */}
      <div className="bento-cell col-span-1 row-span-2 md:row-span-6 p-6 md:p-8 flex flex-col justify-center relative overflow-hidden min-h-[300px]">
        <div className="absolute top-0 right-0 p-4 opacity-5"><UserPlus size={150} /></div>
        <div className="relative z-10">
            <h2 className="text-xs text-blue-500 font-bold font-mono mb-6 uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                Digital ID
            </h2>
            <div className="mb-4">
                <div className="text-3xl md:text-5xl font-thin text-white mb-2 break-all tracking-tighter leading-none">
                    {peerId ? peerId.substring(0, 6) : '......'}
                    <span className="text-zinc-800">{peerId ? peerId.substring(6) : ''}</span>
                </div>
            </div>
            
            {/* Identity Fingerprint Display */}
            {identity && (
              <div className="mb-8 p-3 bg-zinc-900/50 border border-zinc-800/50 rounded flex items-center gap-3">
                 <Fingerprint size={16} className="text-zinc-600"/>
                 <div className="flex flex-col">
                   <span className="text-[10px] text-zinc-500 font-mono uppercase">Your Public Fingerprint</span>
                   <span className="text-xs text-zinc-400 font-mono tracking-widest">{identity.publicKeyFingerprint}</span>
                 </div>
              </div>
            )}
            
            <div className="flex flex-col gap-3">
                <Button variant="secondary" onClick={copyId} className="w-full justify-between group h-14">
                    <span className="text-xs font-mono">{copied ? 'COPIED' : 'COPY SECURE ID'}</span>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-zinc-500 group-hover:text-white"/>}
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

      {/* Local Preview Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 relative group overflow-hidden bg-black min-h-[250px]">
         <video ref={myVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-700 mirror ${isVideoOff ? 'hidden' : 'block'}`} />
         
         {error && (
             <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6 z-20">
                 <div className="flex flex-col items-center text-center">
                    <AlertCircle size={32} className="text-red-500 mb-2" />
                    <span className="text-red-500 font-mono text-xs max-w-sm">{error}</span>
                    {error.includes("use") && <Button variant="ghost" onClick={() => window.location.reload()} className="mt-4">Reload</Button>}
                 </div>
             </div>
         )}
         
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