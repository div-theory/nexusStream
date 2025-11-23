import React, { useState } from 'react';
import { P2PCall } from './components/P2PCall';
import { ShieldCheck, Zap, Sun, Moon } from 'lucide-react';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    if (newTheme === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
  };

  const handleEndCall = () => {
    // P2PCall handles internal state reset to go back to dashboard.
    // We can add global cleanup here if needed.
    console.log("Call ended, returned to dashboard.");
  };

  return (
    <div className="fixed inset-0 bg-background text-primary flex flex-col overflow-hidden transition-colors duration-300">
      
      {/* Main Content */}
      <main role="main" className="flex-1 relative flex flex-col overflow-hidden h-full">
        {/* Header Strip */}
        <header className="h-16 md:h-20 border-b border-border flex items-center justify-between px-6 md:px-8 bg-background z-10 shrink-0 pt-[env(safe-area-inset-top)] md:pt-0 transition-colors">
          <div className="flex flex-col justify-center">
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-primary leading-none">
              talkr<span className="text-accent">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-[10px] font-mono text-secondary uppercase tracking-widest hidden md:flex">
               <ShieldCheck size={14} />
               <span>End-to-End Encrypted</span>
             </div>
             
             {/* Theme Toggle */}
             <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-surface text-secondary hover:text-primary transition-colors">
                 {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
             </button>

             <div className="w-px h-4 bg-border hidden md:block"></div>
             <div className="flex items-center gap-2 text-[10px] font-mono text-accent uppercase tracking-widest">
               <Zap size={14} className="fill-accent" />
               <span className="hidden md:inline">Online</span>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 relative w-full h-full p-0 overflow-hidden">
             <P2PCall 
                onEndCall={handleEndCall} 
                initialStream={null} 
                userSettings={{ displayName: 'You' }}
             />
        </div>
      </main>
    </div>
  );
};

export default App;