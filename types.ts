export interface PeerUser {
  id: string;
  name?: string;
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