
export interface PeerUser {
  id: string;
  name?: string;
}

// Minimal PeerJS type definitions
export interface PeerOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  config?: any;
  debug?: number;
}

// --- SECURITY PROTOCOL TYPES ---

export interface CryptoIdentity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyFingerprint: string; // Hex string of the raw public key
}

export interface EphemeralKeys {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface HandshakePayload {
  type: 'SECURE_HANDSHAKE_INIT' | 'SECURE_HANDSHAKE_RESP';
  identityPublicKey: JsonWebKey; // Long-term Identity
  ephemeralPublicKey: JsonWebKey; // Session Key
  signature: string; // Base64 signature of the ephemeral key signed by identity key
  timestamp: number;
}

export interface SecurityContext {
  isVerified: boolean;
  safetyFingerprint: string; // The "Safety Number" to show UI
  remoteIdentityFingerprint: string;
  sessionSecret?: CryptoKey;
}
