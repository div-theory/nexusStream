import React from 'react';
import { P2PCall } from './components/P2PCall';
import { Shield, Activity } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden">
      
      {/* Main Content */}
      <main role="main" className="flex-1 relative bg-black flex flex-col overflow-hidden h-full">
        {/* Header Strip */}
        <header className="h-14 md:h-16 border-b border-white/10 flex items-center justify-between px-4 md:px-8 bg-black/50 backdrop-blur-sm z-10 shrink-0 pt-[env(safe-area-inset-top)] md:pt-0">
          <div className="flex items-baseline gap-4">
            <h1 className="text-xl md:text-2xl font-thin tracking-tight text-white">
              NEXUS <span className="text-blue-600 font-normal">STREAM</span>
            </h1>
            <div className="hidden md:flex gap-2 items-center">
              <span className="w-1 h-1 bg-zinc-700 rounded-full"></span>
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                P2P Encrypted Protocol
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
               <Shield size={12} strokeWidth={1.5} className="text-blue-500" />
               <span className="hidden md:inline">SECURE CONNECTION</span>
             </div>
             <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
               <Activity size={12} strokeWidth={1.5} className="text-green-500" />
               <span className="hidden md:inline">SYSTEM OPTIMAL</span>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 relative w-full h-full p-0 md:p-1 overflow-hidden">
             <P2PCall onEndCall={() => {}} />
        </div>
      </main>
    </div>
  );
};

export default App;