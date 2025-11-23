import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { Button } from './Button';
import { 
  Camera, CameraOff, Mic, MicOff, PhoneOff, 
  Copy, ArrowRight, Check, Loader2,
  AlertCircle, ShieldCheck, Lock, Fingerprint, User, Zap,
  MessageSquare, Users, LayoutGrid, Monitor, Settings
} from 'lucide-react';
import { SecureProtocolService } from '../services/secureProtocolService';
import { TurnService } from '../services/turnService';
import { MediaService } from '../services/mediaService';
import { CryptoIdentity, EphemeralKeys, SecurityContext, HandshakePayload, ChatMessage, ViewMode, SidePanelTab, UserSettings, ToastNotification } from '../types';

// Types for PeerJS components to avoid strict build errors
type MediaConnection = any;
type DataConnection = any;

interface PeerStatus {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isScreenSharing: boolean;
}

interface P2PCallProps {
  onEndCall: () => void;
  initialStream: MediaStream | null;
  userSettings?: UserSettings;
}

export const P2PCall: React.FC<P2PCallProps> = ({ onEndCall, initialStream, userSettings }) => {
  const [peerId, setPeerId] = useState<string>('');
  const [remotePeerIdValue, setRemotePeerIdValue] = useState('');
  
  // Connections
  const [currentCall, setCurrentCall] = useState<MediaConnection | null>(null);
  const [currentDataConn, setCurrentDataConn] = useState<DataConnection | null>(null);
  
  // Streams
  const [stream, setStream] = useState<MediaStream | null>(initialStream);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  // Local State
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(true); // Default to Voice Only (Video Off)
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHttps, setIsHttps] = useState(true);
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  
  // Remote State (via DataConnection)
  const [remoteStatus, setRemoteStatus] = useState<PeerStatus>({ isVideoEnabled: true, isAudioEnabled: true, isScreenSharing: false });
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  
  const [status, setStatus] = useState<'initializing' | 'idle' | 'calling' | 'connected'>('initializing');
  const [copied, setCopied] = useState(false);

  // --- NEW UI STATES ---
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [activeSidePanel, setActiveSidePanel] = useState<SidePanelTab | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showControls, setShowControls] = useState(true);

  // --- SETTINGS MODAL ---
  const [showSettings, setShowSettings] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

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
  const controlsTimeoutRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const localStreamRef = useRef<MediaStream | null>(initialStream);
  const ephemeralKeysRef = useRef<EphemeralKeys | null>(null); // Per-session keys
  const rotationIntervalRef = useRef<any>(null);
  const initPromiseRef = useRef<Promise<MediaStream> | null>(null);

  // --- HELPER: TOASTS ---
  const addToast = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message: msg, type }]);
    setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // --- INITIAL CHECK ---
  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        setIsHttps(false);
        setError("SECURITY WARNING: Application is running on HTTP. Camera access will be blocked by the browser. Please use HTTPS.");
    }
    
    // Set initial mute/video state based on stream tracks
    if (initialStream) {
        const vTrack = initialStream.getVideoTracks()[0];
        const aTrack = initialStream.getAudioTracks()[0];
        if (vTrack) setIsVideoOff(!vTrack.enabled);
        if (aTrack) setIsMuted(!aTrack.enabled);
    } else {
        // If no initial stream, init immediately for Dashboard Preview
        if (isHttps) initLocalVideo();
    }
    
    // Load devices for settings
    MediaService.getDevices().then(d => {
        setAudioDevices(d.audio);
        setVideoDevices(d.video);
    });
  }, []);

  // --- HELPER: STOP STREAM ---
  const stopLocalStream = () => {
    // We do NOT stop the stream on unmount if we want to preserve it, 
    // but here we likely want to clean up if the component dies
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
            addToast(`User unreachable`, 'error');
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
          // Robustly fetch stream if missing
          initLocalVideo(true) // Force retry
            .then((mediaStream) => {
              if (mediaStream) {
                // Ensure track state matches UI state immediately on answer
                // Default to Video OFF for privacy on answer
                mediaStream.getVideoTracks().forEach(t => t.enabled = false);
                setIsVideoOff(true);
                
                answerCall(mediaStream);
              } else {
                 setError("Could not answer call: Camera access failed.");
              }
            });
        }
      });

      peer.on('connection', (conn: DataConnection) => {
         setCurrentDataConn(conn);
         setupSecureDataConnection(conn, id); 
      });

      peerRef.current = peer;
    };

    if (isHttps) {
        initSystem();
    } else {
        setStatus('idle'); // Just show idle if http (will show error banner)
    }

    return () => {
      peerRef.current?.destroy();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);
      stopLocalStream();
    };
  }, [isHttps]);

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
            conn.send({ type: 'STATUS', video: !isVideoOff, audio: !isMuted, screen: isScreenSharing });
          }
      });

      conn.on('data', async (data: any) => {
          // --- HANDSHAKE HANDLERS ---
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
                  addToast("Secure Connection Established", "success");
               }
             } else {
               setError("SECURITY ALERT: Verification Failed.");
               conn.close();
             }
          }

          // --- STATUS UPDATE ---
          if (data.type === 'STATUS') {
             setRemoteStatus({ 
                 isVideoEnabled: data.video, 
                 isAudioEnabled: data.audio,
                 isScreenSharing: data.screen || false
             });
          }

          // --- CHAT MESSAGE ---
          if (data.type === 'CHAT') {
              const newMsg: ChatMessage = {
                  id: Date.now().toString(),
                  senderId: 'remote',
                  senderName: 'Remote Peer',
                  text: data.text,
                  timestamp: Date.now()
              };
              setChatMessages(prev => [...prev, newMsg]);
              if (activeSidePanel !== 'chat') {
                  setUnreadMessages(prev => prev + 1);
                  addToast("New message", "info");
              }
          }
      });

      conn.on('error', (err: any) => console.error("Data connection error", err));
  };

  useEffect(() => {
    if (activeSidePanel === 'chat') {
        setUnreadMessages(0);
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSidePanel, chatMessages]);

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
      addToast("Call Connected", "success");
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


  const initLocalVideo = async (forceRetry = false): Promise<MediaStream | null> => {
    // Return existing promise if already loading
    if (initPromiseRef.current && !forceRetry) return initPromiseRef.current;
    
    // Return existing stream if already loaded
    if (localStreamRef.current && !forceRetry) return localStreamRef.current;

    setIsStreamLoading(true);
    setError(null);

    const loadTask = (async () => {
      try {
        const mediaStream = await MediaService.getRobustStream();
        setStream(mediaStream);
        localStreamRef.current = mediaStream;
        
        // --- SYNC WITH DEFAULT UI STATE ---
        // Ensure default is VIDEO OFF for privacy
        mediaStream.getVideoTracks().forEach(track => {
            track.enabled = !isVideoOff;
        });
        
        return mediaStream;
      } catch (err: any) {
        console.error("Failed local stream", err);
        setError(MediaService.getErrorMessage(err));
        return null;
      } finally {
        setIsStreamLoading(false);
        initPromiseRef.current = null;
      }
    })();

    initPromiseRef.current = loadTask;
    return loadTask;
  };

  const handleDeviceChange = async (audioId?: string, videoId?: string) => {
      try {
          if (localStreamRef.current) {
              localStreamRef.current.getTracks().forEach(t => t.stop());
          }
          
          const newStream = await MediaService.getStreamWithDeviceId(audioId, videoId);
          setStream(newStream);
          localStreamRef.current = newStream;
          
          // Apply current mute states
          newStream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
          newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);

          // Replace track in active call
          if (currentCall && currentCall.peerConnection) {
              const senders = currentCall.peerConnection.getSenders();
              senders.forEach((sender: any) => {
                  if (sender.track?.kind === 'audio' && newStream.getAudioTracks()[0]) {
                      sender.replaceTrack(newStream.getAudioTracks()[0]);
                  }
                  if (sender.track?.kind === 'video' && newStream.getVideoTracks()[0]) {
                      sender.replaceTrack(newStream.getVideoTracks()[0]);
                  }
              });
          }

          addToast("Device updated", "success");
      } catch (e: any) {
          setError("Failed to switch device: " + e.message);
      }
  };

  const initiateCall = async (remoteId: string) => {
    if (!remoteId) {
        addToast("Enter a valid ID", "error");
        return;
    }

    let currentStream = localStreamRef.current;
    
    // Attempt to initialize stream if missing (Lazy Load)
    if (!currentStream) {
        console.log("Stream not ready, attempting to initialize...");
        try {
            currentStream = await initLocalVideo(true); // Force retry if missing
        } catch (e) {
            setError("Cannot start call: Camera access failed.");
            return;
        }
    }

    if (!peerRef.current || !currentStream || !identity) {
        if (!currentStream) setError("Camera still not ready. Check permissions.");
        else setError("System not initialized.");
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

  const sendStatusUpdate = (video: boolean, audio: boolean, screen: boolean) => {
      if (currentDataConn && currentDataConn.open) {
          currentDataConn.send({ type: 'STATUS', video, audio, screen });
      }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        sendStatusUpdate(!isVideoOff, audioTrack.enabled, isScreenSharing);
        addToast(audioTrack.enabled ? "Microphone On" : "Microphone Muted", "info");
      }
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        sendStatusUpdate(videoTrack.enabled, !isMuted, isScreenSharing);
        addToast(videoTrack.enabled ? "Camera On" : "Camera Off", "info");
      }
    }
  };

  const sendChatMessage = (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!newMessage.trim() || !currentDataConn?.open) return;
      
      const msg: ChatMessage = {
          id: Date.now().toString(),
          senderId: 'me',
          senderName: userSettings?.displayName || 'Me',
          text: newMessage,
          timestamp: Date.now()
      };
      
      currentDataConn.send({ type: 'CHAT', text: newMessage });
      setChatMessages(prev => [...prev, msg]);
      setNewMessage('');
  };

  const handleEndCall = () => {
    currentCall?.close();
    currentDataConn?.close();
    setCurrentCall(null);
    setCurrentDataConn(null);
    setRemoteStream(null);
    setStatus('idle');
    setRemoteStatus({ isVideoEnabled: true, isAudioEnabled: true, isScreenSharing: false });
    setSecurityContext(null);
    setShowFingerprint(false);
    setChatMessages([]);
    setActiveSidePanel(null);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (rotationIntervalRef.current) clearInterval(rotationIntervalRef.current);
    onEndCall(); 
  };

  const copyId = () => {
    if (peerId) {
        navigator.clipboard.writeText(peerId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        addToast("ID Copied to Clipboard", "success");
    }
  };

  // --- IDLE CONTROL HIDER ---
  const handleMouseMove = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
          if (status === 'connected' && !activeSidePanel) setShowControls(false);
      }, 4000);
  };

  const isConnected = status === 'connected' || status === 'calling';

  if (status === 'initializing') {
      return (
          <div className="w-full h-full flex items-center justify-center bg-background flex-col gap-4">
              <Loader2 className="animate-spin text-accent" size={32} />
              <div className="text-secondary font-mono text-xs uppercase tracking-widest">Booting Talkr Node...</div>
          </div>
      );
  }

  // --- CONFERENCE ROOM UI ---
  if (isConnected) {
    return (
      <div 
        className="relative w-full h-full bg-black overflow-hidden flex"
        onMouseMove={handleMouseMove}
        onClick={handleMouseMove}
      >
        {/* TOASTS CONTAINER */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-full max-w-sm px-4">
            {toasts.map(toast => (
                <div key={toast.id} className={`p-3 rounded-xl border backdrop-blur text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-2 flex items-center justify-center ${
                    toast.type === 'error' ? 'bg-red-900/50 border-red-800 text-white' : 
                    toast.type === 'success' ? 'bg-green-900/50 border-green-800 text-white' : 
                    'bg-zinc-900/80 border-zinc-800 text-white'
                }`}>
                    {toast.message}
                </div>
            ))}
        </div>

        {/* MAIN STAGE */}
        <div className={`flex-1 relative flex flex-col transition-all duration-300 ${activeSidePanel ? 'mr-0' : 'mr-0'}`}>
            
            {/* TOP BAR */}
            <div className={`absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent z-40 flex items-center justify-between px-6 transition-transform duration-300 ${showControls || activeSidePanel ? 'translate-y-0' : '-translate-y-full'}`}>
                 <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-zinc-900/80 backdrop-blur rounded-full border border-white/10">
                        <Lock size={12} className={securityContext?.isVerified ? "text-green-400" : "text-yellow-400"} />
                        <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">
                            {securityContext?.isVerified ? 'E2EE SECURE' : 'VERIFYING...'}
                        </span>
                    </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                     <Button variant="ghost" size="icon" onClick={() => setShowFingerprint(!showFingerprint)}>
                         <ShieldCheck size={20} className={showFingerprint ? 'text-accent' : 'text-zinc-400'} />
                     </Button>
                     <Button variant="ghost" size="icon" onClick={() => setActiveSidePanel(activeSidePanel === 'people' ? null : 'people')}>
                         <Users size={20} className={activeSidePanel === 'people' ? 'text-accent' : 'text-zinc-400'} />
                     </Button>
                     <Button variant="ghost" size="icon" className="relative" onClick={() => setActiveSidePanel(activeSidePanel === 'chat' ? null : 'chat')}>
                         <MessageSquare size={20} className={activeSidePanel === 'chat' ? 'text-accent' : 'text-zinc-400'} />
                         {unreadMessages > 0 && (
                             <span className="absolute top-2 right-2 w-2 h-2 bg-accent rounded-full"></span>
                         )}
                     </Button>
                 </div>
            </div>

            {/* FINGERPRINT OVERLAY */}
            {showFingerprint && securityContext && (
                 <div className="absolute top-20 left-6 z-50 p-5 bg-black border border-zinc-800 rounded-2xl shadow-2xl max-w-xs animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-zinc-500">
                            <Fingerprint size={16} />
                            <span className="text-xs font-mono uppercase tracking-widest">Safety Number</span>
                        </div>
                        <button onClick={() => setShowFingerprint(false)} className="text-zinc-500 hover:text-white">&times;</button>
                    </div>
                    <div className="grid grid-cols-4 gap-2 font-mono text-xl text-white tracking-tighter mb-4">
                        {securityContext.safetyFingerprint.split(' ').map((block, i) => (
                            <span key={i} className="bg-zinc-900 p-1 text-center border border-zinc-800 rounded">{block}</span>
                        ))}
                    </div>
                    <div className="text-[10px] text-zinc-600 leading-relaxed uppercase">
                        Verify this number matches on your peer's device to ensure security.
                    </div>
                 </div>
            )}

            {/* VIDEO GRID */}
            <div className="flex-1 p-4 flex items-center justify-center">
                 <div className="relative w-full h-full max-w-6xl max-h-[80vh] flex items-center justify-center">
                     
                     {/* REMOTE VIEW */}
                     <div className={`relative w-full h-full rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800 transition-all duration-500 ${viewMode === 'spotlight' ? 'flex-1' : 'aspect-video'}`}>
                        {/* Audio Visualizer if Video Off */}
                        <div className={`absolute inset-0 flex items-center justify-center bg-zinc-900 z-10 transition-opacity duration-500 ${!remoteStatus.isVideoEnabled ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                            <div className={`w-32 h-32 rounded-full border border-zinc-700 flex items-center justify-center relative ${isRemoteSpeaking ? 'bg-zinc-800 shadow-[0_0_50px_rgba(37,99,235,0.2)]' : ''}`}>
                                {isRemoteSpeaking ? <Zap size={40} className="text-accent fill-accent" /> : <User size={40} className="text-zinc-600" />}
                            </div>
                        </div>
                        <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                        <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/60 backdrop-blur rounded-lg text-white text-xs font-medium">
                            Remote Peer {isRemoteSpeaking && '• Speaking'}
                        </div>
                     </div>

                     {/* LOCAL PIP */}
                     <div className={`absolute bottom-4 right-4 w-48 aspect-video bg-black rounded-xl border border-zinc-700 shadow-2xl overflow-hidden z-30 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isVideoOff ? 'translate-y-[120%] opacity-0' : 'translate-y-0 opacity-100'}`}>
                         <video ref={myVideoRef} autoPlay playsInline muted className="w-full h-full object-cover mirror" />
                         <div className="absolute bottom-2 left-2 text-[10px] text-white/80 font-medium px-2 py-0.5 bg-black/50 rounded">You</div>
                     </div>

                 </div>
            </div>

            {/* TIMER (BOTTOM POSITION) */}
            <div className={`absolute bottom-32 left-1/2 -translate-x-1/2 z-30 transition-opacity duration-500 ${showControls ? 'opacity-40 hover:opacity-100' : 'opacity-0'}`}>
                <div className="px-3 py-1 bg-black/50 backdrop-blur rounded-full border border-white/10 flex items-center gap-2 cursor-default">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    <span className="text-[10px] font-mono text-white tracking-widest">{formatDuration(callDuration)}</span>
                </div>
            </div>

            {/* BOTTOM CONTROLS */}
            <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ${showControls || activeSidePanel ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0'}`}>
                <div className="flex items-center gap-3 p-3 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
                    <button onClick={toggleAudio} className={`p-3 rounded-full transition-all ${isMuted ? 'bg-red-600 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                        {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                    </button>
                    <button onClick={toggleVideo} className={`p-3 rounded-full transition-all ${isVideoOff ? 'bg-red-600 text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                        {isVideoOff ? <CameraOff size={20} /> : <Camera size={20} />}
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-1"></div>
                    <button className="p-3 rounded-full bg-zinc-800 text-white hover:bg-zinc-700" onClick={() => setViewMode(viewMode === 'gallery' ? 'spotlight' : 'gallery')}>
                        {viewMode === 'gallery' ? <Monitor size={20} /> : <LayoutGrid size={20} />}
                    </button>
                    <button 
                        onClick={onEndCall} 
                        className="px-6 py-3 rounded-full bg-red-600 text-white hover:bg-red-500 font-bold tracking-wide transition-all ml-2"
                    >
                        <PhoneOff size={20} />
                    </button>
                </div>
            </div>

        </div>

        {/* SIDE PANEL */}
        <div className={`fixed inset-y-0 right-0 w-80 bg-surface border-l border-border shadow-2xl transform transition-transform duration-300 z-50 ${activeSidePanel ? 'translate-x-0' : 'translate-x-full'}`}>
             <div className="flex flex-col h-full">
                 <div className="h-16 flex items-center justify-between px-6 border-b border-border">
                     <h3 className="font-mono text-sm uppercase tracking-widest text-primary">
                         {activeSidePanel === 'people' ? 'Participants' : 'Chat'}
                     </h3>
                     <button onClick={() => setActiveSidePanel(null)} className="text-secondary hover:text-primary">&times;</button>
                 </div>

                 {activeSidePanel === 'chat' && (
                     <div className="flex-1 flex flex-col overflow-hidden">
                         <div className="flex-1 overflow-y-auto p-4 space-y-4">
                             {chatMessages.length === 0 && (
                                 <div className="text-center text-secondary mt-10 text-xs font-mono">No messages yet.</div>
                             )}
                             {chatMessages.map((msg) => (
                                 <div key={msg.id} className={`flex flex-col ${msg.senderId === 'me' ? 'items-end' : 'items-start'}`}>
                                     <div className={`max-w-[85%] p-3 rounded-xl text-sm ${msg.senderId === 'me' ? 'bg-accent text-white rounded-tr-none' : 'bg-surface-highlight text-primary rounded-tl-none border border-border'}`}>
                                         {msg.text}
                                     </div>
                                     <span className="text-[10px] text-secondary mt-1">
                                         {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                     </span>
                                 </div>
                             ))}
                             <div ref={chatEndRef} />
                         </div>
                         <form onSubmit={sendChatMessage} className="p-4 border-t border-border bg-surface">
                             <div className="relative">
                                 <input 
                                    className="w-full bg-input border border-border rounded-full px-4 py-3 pr-10 text-sm text-primary placeholder:text-secondary focus:outline-none focus:border-accent"
                                    placeholder="Send a message..."
                                    value={newMessage}
                                    onChange={e => setNewMessage(e.target.value)}
                                 />
                                 <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-accent rounded-full text-white disabled:opacity-50" disabled={!newMessage.trim()}>
                                     <ArrowRight size={14} />
                                 </button>
                             </div>
                         </form>
                     </div>
                 )}

                 {activeSidePanel === 'people' && (
                     <div className="p-4 space-y-4">
                         <div className="flex items-center justify-between p-3 bg-surface-highlight rounded-xl border border-border">
                             <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-white">ME</div>
                                 <div className="flex flex-col">
                                     <span className="text-sm font-bold text-primary">{userSettings?.displayName || 'You'}</span>
                                     <span className="text-[10px] text-secondary font-mono">Host</span>
                                 </div>
                             </div>
                             <Mic size={14} className={isMuted ? "text-red-500" : "text-secondary"} />
                         </div>
                         <div className="flex items-center justify-between p-3 bg-surface-highlight rounded-xl border border-border">
                             <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white">P2</div>
                                 <div className="flex flex-col">
                                     <span className="text-sm font-bold text-primary">Remote Peer</span>
                                     <span className="text-[10px] text-secondary font-mono">Connected</span>
                                 </div>
                             </div>
                             <Mic size={14} className={!remoteStatus.isAudioEnabled ? "text-red-500" : "text-secondary"} />
                         </div>
                     </div>
                 )}
             </div>
        </div>

      </div>
    );
  }

  // DASHBOARD - BENTO GRID LAYOUT
  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:grid-rows-6 p-4 gap-4 auto-rows-fr">
      
      {/* Identity Card */}
      <div className="bento-cell col-span-1 row-span-2 md:row-span-6 p-8 md:p-12 flex flex-col justify-center relative overflow-hidden min-h-[300px] rounded-3xl border border-border bg-surface shadow-sm">
        <div className="absolute -top-10 -right-10 p-0 opacity-[0.03] text-primary"><User size={400} /></div>
        <div className="relative z-10 flex flex-col h-full justify-center">
            <h2 className="text-xs text-accent font-bold font-mono mb-8 uppercase tracking-[0.2em] flex items-center gap-2">
                <div className="w-2 h-2 bg-accent rounded-full"></div>
                My Signal
            </h2>
            
            <div className="mb-4">
                <div className="text-2xl md:text-4xl font-black text-primary mb-2 break-all tracking-tighter leading-tight">
                    {peerId ? peerId.substring(0, 6) : '......'}
                    <span className="text-secondary">{peerId ? peerId.substring(6) : ''}</span>
                </div>
            </div>
            
            {identity && (
              <div className="mb-10 flex items-center gap-4 select-text">
                 <Fingerprint size={36} strokeWidth={1} className="text-secondary shrink-0"/>
                 <div className="flex flex-col gap-1">
                   <span className="text-xs font-mono uppercase tracking-[0.2em] text-secondary">Public Key Hash</span>
                   <span className="text-lg md:text-xl text-accent font-mono tracking-widest leading-none">{identity.publicKeyFingerprint}</span>
                 </div>
              </div>
            )}
            
            <div className="mt-auto">
                <Button variant="secondary" onClick={copyId} className="w-full justify-between group h-16 rounded-full">
                    <span className="text-sm font-mono tracking-widest uppercase pl-2">{copied ? 'COPIED TO CLIPBOARD' : 'COPY ID'}</span>
                    {copied ? <Check size={20} className="text-green-600" /> : <Copy size={20} className="text-secondary group-hover:text-primary"/>}
                </Button>
            </div>
        </div>
      </div>

      {/* Connect Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 p-8 md:p-12 flex flex-col justify-center bg-surface min-h-[300px] rounded-3xl border border-border shadow-sm">
         {/* Updated Header */}
         <div className="flex items-center gap-6 mb-8">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-primary uppercase leading-none">
                ENTER ID
            </h1>
            <ArrowRight className="w-12 h-12 md:w-16 md:h-16 text-primary stroke-[1.5]" />
         </div>

         {/* Updated Pill Input Bar */}
         <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
             <div className="flex-1 w-full bg-input rounded-2xl p-2 flex items-center border border-border shadow-inner relative group transition-colors focus-within:ring-2 focus-within:ring-accent/20">
                 <input 
                    type="text" 
                    placeholder="000ebb6d-673f-41ac..."
                    className="w-full bg-transparent border-none px-4 py-3 text-lg md:text-xl font-mono font-bold text-primary placeholder:text-secondary focus:outline-none focus:ring-0"
                    value={remotePeerIdValue}
                    onChange={e => setRemotePeerIdValue(e.target.value)}
                 />
                 <Button 
                    variant="primary"
                    size="icon"
                    className="shrink-0 w-12 h-12 rounded-xl shadow-sm"
                    onClick={() => initiateCall(remotePeerIdValue)} 
                    disabled={!remotePeerIdValue || !peerId || isStreamLoading}
                >
                    {isStreamLoading ? <Loader2 className="animate-spin text-background" size={24} /> : <ArrowRight className="text-background" size={24} />}
                </Button>
             </div>

             {/* Side Metadata */}
             <div className="hidden md:flex flex-col gap-1 shrink-0">
                 <span className="text-[10px] font-mono uppercase tracking-widest text-secondary">PUBLIC KEY HASH</span>
                 <span className="text-xs font-mono font-bold text-secondary">09760dff068340bd</span>
             </div>
         </div>
      </div>

      {/* Local Preview Card */}
      <div className="bento-cell col-span-1 md:col-span-1 lg:col-span-2 row-span-2 md:row-span-3 relative group overflow-hidden bg-black min-h-[250px] rounded-3xl border border-border shadow-sm">
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
                    {error.includes("Camera") && <Button variant="primary" onClick={() => initLocalVideo(true)} className="mt-6 border-zinc-600 rounded-full">Retry Camera</Button>}
                 </div>
             </div>
         )}
         
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             {isVideoOff && !error ? (
                 <div className="flex flex-col items-center gap-6 text-zinc-500 animate-in fade-in zoom-in duration-500">
                     <CameraOff size={64} strokeWidth={1} />
                     <span className="font-mono text-xs tracking-[0.3em] uppercase">Camera Disabled</span>
                 </div>
             ) : (
                 !error && <div className="text-white/5 font-black text-8xl tracking-tighter uppercase select-none">Preview</div>
             )}
         </div>

         <div className="absolute bottom-8 right-8 flex gap-3 z-20">
            <Button 
                variant="secondary" 
                className="rounded-full bg-black/50 text-white border-white/20 hover:bg-white hover:text-black"
                onClick={() => setShowSettings(true)}
            >
                <Settings size={20} />
            </Button>

            <button onClick={toggleVideo} className={`p-4 border text-white transition-all rounded-full ${isVideoOff ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800' : 'bg-black border-zinc-800 hover:bg-white hover:text-black'}`}>
                {isVideoOff ? <CameraOff size={20} /> : <Camera size={20} />}
            </button>
            <button onClick={toggleAudio} className={`p-4 border text-white transition-all rounded-full ${isMuted ? 'bg-red-900/20 border-red-900 text-red-500' : 'bg-black border-zinc-800 hover:bg-white hover:text-black'}`}>
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
         </div>
      </div>
      
      {/* Settings Modal (Added back for simple access) */}
      {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-surface border border-border rounded-3xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-primary">Settings</h3>
                      <button onClick={() => setShowSettings(false)} className="text-secondary hover:text-primary">&times;</button>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-mono uppercase text-secondary mb-2 block">Camera</label>
                          <select 
                             className="w-full bg-input border border-border rounded-xl p-3 text-sm text-primary"
                             onChange={(e) => handleDeviceChange(undefined, e.target.value)}
                          >
                             {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="text-xs font-mono uppercase text-secondary mb-2 block">Microphone</label>
                          <select 
                             className="w-full bg-input border border-border rounded-xl p-3 text-sm text-primary"
                             onChange={(e) => handleDeviceChange(e.target.value, undefined)}
                          >
                             {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Mic'}</option>)}
                          </select>
                      </div>
                  </div>
                  
                  <div className="mt-8">
                      <Button variant="primary" className="w-full rounded-xl" onClick={() => setShowSettings(false)}>Done</Button>
                  </div>
              </div>
          </div>
      )}

      {/* TOASTS (Dashboard position) */}
      <div className="fixed top-24 right-6 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
          {toasts.map(toast => (
              <div key={toast.id} className={`p-3 rounded-xl border backdrop-blur text-sm font-medium shadow-lg animate-in fade-in slide-in-from-right-2 flex items-center justify-center pointer-events-auto ${
                  toast.type === 'error' ? 'bg-red-900/50 border-red-800 text-white' : 
                  toast.type === 'success' ? 'bg-green-900/50 border-green-800 text-white' : 
                  'bg-surface/90 border-border text-primary'
              }`}>
                  {toast.message}
              </div>
          ))}
      </div>
    </div>
  );
};