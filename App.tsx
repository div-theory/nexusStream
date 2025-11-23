import React, { useState } from 'react';
import { P2PCall } from './components/P2PCall';
import { GeminiLiveAssistant } from './components/GeminiLiveAssistant';
import { Video, Bot, Shield, Globe, Activity } from 'lucide-react';

type Tab = 'p2p' | 'ai';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('p2p');

  return (
    <div className="h-[100dvh] w-screen bg-black text-white overflow-hidden flex flex-col md:flex-row supports-[height:100dvh]:h-[100dvh]">
      
      {/* Navigation Rail - Vertical Grid Section */}
      <nav className="w-full md:w-16 flex md:flex-col border-b md:border-b-0 md:border-r border-white/10 bg-black z-20 shrink-0 order-2 md:order-1 pb-[env(safe-area-inset-bottom)] md:pb-0">
         <div className="hidden md:flex p-4 items-center justify-center border-b border-white/10">
            <Globe strokeWidth={1} className="text-white" size={20} />
         </div>
         
         <div className="flex-1 flex md:flex-col items-center justify-around md:justify-center gap-0 md:gap-0">
             <button 
                onClick={() => setActiveTab('p2p')}
                className={`flex-1 md:flex-none w-full p-4 flex justify-center transition-colors duration-300 relative group ${activeTab === 'p2p' ? 'text-white' : 'text-zinc-600 hover:text-white'}`}
                title="P2P Video Call"
             >
                <Video strokeWidth={1} size={20} />
                {activeTab === 'p2p' && <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-blue-600 hidden md:block" />}
                {activeTab === 'p2p' && <div className="absolute left-0 right-0 top-0 h-[1px] bg-blue-600 md:hidden" />}
             </button>
             <button 
                onClick={() => setActiveTab('ai')}
                className={`flex-1 md:flex-none w-full p-4 flex justify-center transition-colors duration-300 relative group ${activeTab === 'ai' ? 'text-blue-500' : 'text-zinc-600 hover:text-blue-400'}`}
                title="Gemini AI Companion"
             >
                <Bot strokeWidth={1} size={20} />
                {activeTab === 'ai' && <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-blue-600 hidden md:block" />}
                {activeTab === 'ai' && <div className="absolute left-0 right-0 top-0 h-[1px] bg-blue-600 md:hidden" />}
             </button>
         </div>

         <div className="hidden md:flex p-4 flex-col items-center gap-4 text-zinc-600 border-t border-white/10">
            <Shield strokeWidth={1} size={16} className="hover:text-zinc-400 transition-colors cursor-help" />
            <div className="text-[10px] font-mono -rotate-90 whitespace-nowrap tracking-widest opacity-50">v2.1</div>
         </div>
      </nav>

      {/* Main Content - Bento Grid Layout */}
      <main className="flex-1 relative h-full bg-black overflow-hidden flex flex-col order-1 md:order-2">
        {/* Header Strip */}
        <header className="h-14 md:h-16 border-b border-white/10 flex items-center justify-between px-4 md:px-8 bg-black/50 backdrop-blur-sm z-10 shrink-0 pt-[env(safe-area-inset-top)] md:pt-0">
          <div className="flex items-baseline gap-4">
            <h1 className="text-xl md:text-2xl font-thin tracking-tight text-white">
              {activeTab === 'p2p' ? 'NEXUS' : 'GEMINI'} <span className="text-blue-600 font-normal">{activeTab === 'p2p' ? 'STREAM' : 'LIVE'}</span>
            </h1>
            <div className="hidden md:flex gap-2 items-center">
              <span className="w-1 h-1 bg-zinc-700 rounded-full"></span>
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                {activeTab === 'p2p' ? 'P2P Encrypted Protocol' : 'Real-time Reasoning Model'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
               <Activity size={12} strokeWidth={1.5} className={activeTab === 'ai' ? 'text-blue-500 animate-pulse' : 'text-green-500'} />
               <span className="hidden md:inline">SYSTEM OPTIMAL</span>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 min-h-0 relative p-0 md:p-1 overflow-hidden">
             {activeTab === 'p2p' ? (
                 <P2PCall onEndCall={() => {}} />
             ) : (
                 <div className="h-full w-full max-w-5xl mx-auto md:py-8 md:px-8">
                     <GeminiLiveAssistant />
                 </div>
             )}
        </div>
      </main>
    </div>
  );
};

export default App;