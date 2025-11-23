import React, { useEffect, useRef, useState } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { Button } from './Button';
import { 
  Camera, CameraOff, Mic, MicOff, Monitor, PhoneOff, 
  Copy, Share2, Signal, MonitorOff 
} from 'lucide-react';

interface P2PCallProps {
  onEndCall: () => void;
}

export const P2PCall: React.FC<P2PCallProps> = ({ onEndCall }) => {
  const [peerId, setPeerId] = useState<string>('');
  const [remotePeerIdValue, setRemotePeerIdValue] = useState('');
  const [currentCall, setCurrentCall] = useState<MediaConnection | null>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [status, setStatus] = useState<'initializing' | 'idle' | 'calling' | 'connected'>('initializing');

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);

  // Initialize Peer
  useEffect(() => {
    import('peerjs').then(({ default: Peer }) => {
      const peer = new Peer();
      
      peer.on('open', (id) => {
        setPeerId(id);
        setStatus('idle');
      });

      peer.on('call', (call) => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          .then((mediaStream) => {
            setStream(mediaStream);
            if (myVideoRef.current) myVideoRef.current.srcObject = mediaStream;
            
            call.answer(mediaStream);
            
            call.on('stream', (remoteStream) => {
              setRemoteStream(remoteStream);
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
              setStatus('connected');
            });

            call.on('close', () => {
              handleEndCall();
            });

            setCurrentCall(call);
            setStatus('connected');
          });
      });

      peerRef.current = peer;
    });

    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  // Initialize Local Video
  useEffect(() => {
    const initLocalVideo = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setStream(mediaStream);
        if (myVideoRef.current) myVideoRef.current.srcObject = mediaStream;
      } catch (err) {
        console.error("Failed to get local stream", err);
      }
    };
    initLocalVideo();
    
    return () => {
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const initiateCall = (remoteId: string) => {
    if (!peerRef.current || !stream) return;
    setStatus('calling');
    
    const call = peerRef.current.call(remoteId, stream);
    
    call.on('stream', (remoteStream) => {
      setRemoteStream(remoteStream);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      setStatus('connected');
    });

    call.on('close', () => {
      setRemoteStream(null);
      setStatus('idle');
      setCurrentCall(null);
    });

    setCurrentCall(call);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: !isVideoOff, audio: true });
      replaceStream(newStream);
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        replaceStream(screenStream);
        setIsScreenSharing(true);
        screenStream.getVideoTracks()[0].onended = () => {
            toggleScreenShare();
        };
      } catch (e) {
        console.error("Screen share cancelled", e);
      }
    }
  };

  const replaceStream = (newStream: MediaStream) => {
    if (stream) {
      stream.getTracks().forEach(track => {
        if (track.kind === 'video' && newStream.getVideoTracks().length > 0) track.stop();
      });
    }

    setStream(newStream);
    if (myVideoRef.current) myVideoRef.current.srcObject = newStream;

    if (currentCall && currentCall.peerConnection) {
        const videoTrack = newStream.getVideoTracks()[0];
        const audioTrack = newStream.getAudioTracks()[0];
        const senders = currentCall.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);
        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (audioSender && audioTrack) audioSender.replaceTrack(audioTrack);
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const handleEndCall = () => {
    currentCall?.close();
    setCurrentCall(null);
    setRemoteStream(null);
    setStatus('idle');
    onEndCall();
  };

  const copyId = () => {
    navigator.clipboard.writeText(peerId);
  };

  return (
    <div className="w-full h-full bento-grid grid-cols-1 md:grid-cols-4 grid-rows-6 md:grid-rows-12">
      
      {/* Main Connection Status / Controls - Top Left */}
      <div className="bento-cell md:col-span-1 md:row-span-12 p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-white/10">
        <div className="space-y-6">
            <div>
                <h2 className="text-sm text-zinc-500 font-mono mb-2 uppercase tracking-widest">Identity</h2>
                <div className="p-3 bg-zinc-900 border border-white/10 flex flex-col gap-2">
                    <span className="font-mono text-xs text-blue-400 break-all">{peerId || 'INITIALIZING...'}</span>
                    <button onClick={copyId} className="flex items-center gap-2 text-xs text-white hover:text-blue-400 transition-colors uppercase tracking-wider">
                        <Copy size={12} /> Copy ID
                    </button>
                </div>
            </div>

            {status === 'idle' && (
                <div>
                    <h2 className="text-sm text-zinc-500 font-mono mb-2 uppercase tracking-widest">Connect</h2>
                    <div className="space-y-2">
                        <input 
                            type="text" 
                            placeholder="REMOTE ID"
                            className="w-full bg-black border border-white/20 p-3 text-sm text-white font-mono placeholder:text-zinc-700 focus:border-blue-600 focus:outline-none transition-colors"
                            value={remotePeerIdValue}
                            onChange={e => setRemotePeerIdValue(e.target.value)}
                        />
                        <Button variant="primary" className="w-full" onClick={() => initiateCall(remotePeerIdValue)} disabled={!remotePeerIdValue}>
                            Connect
                        </Button>
                    </div>
                </div>
            )}

            <div>
                 <h2 className="text-sm text-zinc-500 font-mono mb-2 uppercase tracking-widest">Status</h2>
                 <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 ${status === 'connected' ? 'bg-blue-500' : 'bg-zinc-700'}`}></div>
                    <span className="text-sm font-light uppercase">{status}</span>
                 </div>
            </div>
        </div>

        {/* Local Preview - Bottom of sidebar */}
        <div className="mt-auto pt-6 border-t border-white/10">
            <h2 className="text-sm text-zinc-500 font-mono mb-2 uppercase tracking-widest">Local Feed</h2>
            <div className="aspect-video bg-zinc-900 border border-white/10 relative overflow-hidden group">
                <video ref={myVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
                {isVideoOff && (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
                        <CameraOff strokeWidth={1} size={24} />
                    </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                    <div className={`w-1 h-1 ${isMuted ? 'bg-red-500' : 'bg-green-500'}`}></div>
                </div>
            </div>
        </div>
      </div>

      {/* Main Viewport - Right Side */}
      <div className="bento-cell md:col-span-3 md:row-span-11 relative bg-zinc-950 flex flex-col">
        {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
        ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-800 bg-black bg-[radial-gradient(#111_1px,transparent_1px)] [background-size:16px_16px]">
                <Signal strokeWidth={0.5} size={64} className="mb-4 text-zinc-900" />
                <p className="font-mono text-xs tracking-[0.2em] text-zinc-700">WAITING FOR SIGNAL</p>
            </div>
        )}
      </div>

      {/* Action Bar - Bottom Right Strip */}
      <div className="bento-cell md:col-span-3 md:row-span-1 bg-black border-t border-white/10 flex items-center justify-center gap-px">
        <button 
            onClick={toggleAudio} 
            className={`h-full flex-1 flex items-center justify-center hover:bg-white/5 transition-colors group ${isMuted ? 'text-red-500' : 'text-white'}`}
            title="Toggle Mic"
        >
            {isMuted ? <MicOff strokeWidth={1} size={20} /> : <Mic strokeWidth={1} size={20} />}
        </button>
        <div className="w-px h-1/2 bg-white/10"></div>
        <button 
            onClick={toggleVideo} 
            className={`h-full flex-1 flex items-center justify-center hover:bg-white/5 transition-colors group ${isVideoOff ? 'text-red-500' : 'text-white'}`}
            title="Toggle Camera"
        >
             {isVideoOff ? <CameraOff strokeWidth={1} size={20} /> : <Camera strokeWidth={1} size={20} />}
        </button>
        <div className="w-px h-1/2 bg-white/10"></div>
        <button 
            onClick={toggleScreenShare} 
            className={`h-full flex-1 flex items-center justify-center hover:bg-white/5 transition-colors ${isScreenSharing ? 'text-blue-500' : 'text-white'}`}
            title="Share Screen"
        >
            {isScreenSharing ? <MonitorOff strokeWidth={1} size={20} /> : <Monitor strokeWidth={1} size={20} />}
        </button>
        
        {/* End Call is wider and distinct */}
        <button 
            onClick={handleEndCall}
            className="h-full px-8 bg-white text-black hover:bg-red-600 hover:text-white transition-colors flex items-center gap-2 uppercase text-xs tracking-widest font-bold ml-auto"
        >
            <PhoneOff size={14} /> End
        </button>
      </div>
    </div>
  );
};