import React from 'react';
import { P2PCall } from './components/P2PCall';
import { ShieldCheck, Zap } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden">
      
      {/* Main Content */}
      <main role="main" className="flex-1 relative bg-black flex flex-col overflow-hidden h-full">
        {/* Header Strip */}
        <header className="h-16 md:h-20 border-b border-white/10 flex items-center justify-between px-6 md:px-8 bg-black z-10 shrink-0 pt-[env(safe-area-inset-top)] md:pt-0">
          <div className="flex flex-col justify-center">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-white leading-none">
              talkr<span className="text-blue-600">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
               <ShieldCheck size={14} className="text-zinc-600" />
               <span className="hidden md:inline">End-to-End Encrypted</span>
             </div>
             <div className="w-px h-4 bg-zinc-800 hidden md:block"></div>
             <div className="flex items-center gap-2 text-[10px] font-mono text-blue-600 uppercase tracking-widest">
               <Zap size={14} className="fill-blue-600" />
               <span className="hidden md:inline">Online</span>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 relative w-full h-full p-0 overflow-hidden">
             <P2PCall onEndCall={() => {}} />
        </div>
      </main>
    </div>
  );
};

export default App;