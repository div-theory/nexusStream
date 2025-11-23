export interface PeerUser {
  id: string;
  name?: string;
}

export type AppMode = 'home' | 'p2p-call' | 'gemini-live';

export interface Message {
  id: string;
  sender: 'user' | 'model';
  text: string;
  timestamp: Date;
}

// Minimal PeerJS type definitions to avoid implicit any if library types aren't loaded
export interface PeerOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  config?: any;
  debug?: number;
}
