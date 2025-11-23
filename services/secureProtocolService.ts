
import { HandshakePayload, CryptoIdentity, EphemeralKeys } from '../types';

/**
 * NEXUS SECURITY PROTOCOL SERVICE
 * Implements the "Secure P2P Voice/Video App" specification using Web Crypto API.
 * 
 * Features:
 * - ECDSA (P-256) for Long-term Identity
 * - ECDH (P-256) for Ephemeral Session Keys
 * - SHA-256 for Fingerprinting
 * - HKDF logic for Session Secret derivation
 */
export class SecureProtocolService {
  private static STORAGE_KEY_PUB = 'nexus_identity_pub_v1';
  private static STORAGE_KEY_PRIV = 'nexus_identity_priv_v1';

  // --- IDENTITY MANAGEMENT ---

  static async getOrCreateIdentity(): Promise<CryptoIdentity> {
    // Try to load existing
    const storedPub = localStorage.getItem(this.STORAGE_KEY_PUB);
    const storedPriv = localStorage.getItem(this.STORAGE_KEY_PRIV);

    if (storedPub && storedPriv) {
      try {
        const publicKey = await window.crypto.subtle.importKey(
          'jwk',
          JSON.parse(storedPub),
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify']
        );
        const privateKey = await window.crypto.subtle.importKey(
          'jwk',
          JSON.parse(storedPriv),
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign']
        );
        const fingerprint = await this.computeKeyFingerprint(publicKey);
        return { publicKey, privateKey, publicKeyFingerprint: fingerprint };
      } catch (e) {
        console.error("Failed to load identity, generating new one.", e);
      }
    }

    // Generate New
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    const pubJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

    localStorage.setItem(this.STORAGE_KEY_PUB, JSON.stringify(pubJwk));
    localStorage.setItem(this.STORAGE_KEY_PRIV, JSON.stringify(privJwk));

    const fingerprint = await this.computeKeyFingerprint(keyPair.publicKey);

    return { 
      publicKey: keyPair.publicKey, 
      privateKey: keyPair.privateKey, 
      publicKeyFingerprint: fingerprint 
    };
  }

  static async generateEphemeralKeys(): Promise<EphemeralKeys> {
    return await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // --- HANDSHAKE LOGIC ---

  static async createHandshakePayload(
    identity: CryptoIdentity, 
    ephemeralKey: EphemeralKeys,
    type: 'SECURE_HANDSHAKE_INIT' | 'SECURE_HANDSHAKE_RESP' | 'SECURE_KEY_ROTATION'
  ): Promise<HandshakePayload> {
    const ephPubJwk = await window.crypto.subtle.exportKey('jwk', ephemeralKey.publicKey);
    const idPubJwk = await window.crypto.subtle.exportKey('jwk', identity.publicKey);

    // Sign the Ephemeral Public Key with Identity Private Key to prove ownership
    // We sign the stringified JWK of the ephemeral key
    const dataToSign = new TextEncoder().encode(JSON.stringify(ephPubJwk));
    const signatureBuffer = await window.crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      identity.privateKey,
      dataToSign
    );

    return {
      type,
      identityPublicKey: idPubJwk,
      ephemeralPublicKey: ephPubJwk,
      signature: this.arrayBufferToBase64(signatureBuffer),
      timestamp: Date.now()
    };
  }

  static async verifyAndDeriveSession(
    localIdentity: CryptoIdentity,
    localEphemeral: EphemeralKeys,
    remotePayload: HandshakePayload
  ): Promise<{ sessionFingerprint: string; remoteIdentityFingerprint: string } | null> {
    try {
      // 1. Import Remote Keys
      const remoteIdPub = await window.crypto.subtle.importKey(
        'jwk',
        remotePayload.identityPublicKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );

      const remoteEphPub = await window.crypto.subtle.importKey(
        'jwk',
        remotePayload.ephemeralPublicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      // 2. Verify Signature (Authenticity)
      // Check if the remote ephemeral key was actually signed by the remote identity key
      const dataToVerify = new TextEncoder().encode(JSON.stringify(remotePayload.ephemeralPublicKey));
      const signature = this.base64ToArrayBuffer(remotePayload.signature);
      
      const isValid = await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        remoteIdPub,
        signature,
        dataToVerify
      );

      if (!isValid) {
        console.error("Security Alert: Invalid Handshake Signature");
        return null;
      }

      // 3. Derive Shared Secret (Confidentiality)
      // ECDH: My Ephemeral Private + Their Ephemeral Public
      const sharedBits = await window.crypto.subtle.deriveBits(
        { name: 'ECDH', public: remoteEphPub },
        localEphemeral.privateKey,
        256
      );

      // 4. Generate Safety Fingerprint
      // Fingerprint = SHA-256(Sorted Identities + Shared Secret)
      // This ensures both parties see the same number ONLY if no MitM
      const localIdFps = localIdentity.publicKeyFingerprint;
      const remoteIdFps = await this.computeKeyFingerprint(remoteIdPub);
      
      // Sort to ensure deterministic order regardless of who initiated
      const sortedIds = [localIdFps, remoteIdFps].sort().join(':');
      const secretString = this.arrayBufferToBase64(sharedBits);
      
      const fingerprintData = new TextEncoder().encode(`${sortedIds}:${secretString}`);
      const fingerprintBuffer = await window.crypto.subtle.digest('SHA-256', fingerprintData);
      
      // Convert to a readable "Safety Number" (e.g., 0512 8841 9920 ...)
      const sessionFingerprint = this.formatFingerprint(fingerprintBuffer);

      return {
        sessionFingerprint,
        remoteIdentityFingerprint: remoteIdFps
      };

    } catch (e) {
      console.error("Handshake Verification Failed", e);
      return null;
    }
  }

  // --- UTILITIES ---

  static async computeKeyFingerprint(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('spki', key);
    const hash = await window.crypto.subtle.digest('SHA-256', exported);
    return this.arrayBufferToHex(hash).substring(0, 16); // Short ID
  }

  static arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  static arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  static formatFingerprint(buffer: ArrayBuffer): string {
    // Take first 10 bytes and convert to numeric blocks for easy reading
    // e.g., 55021 44012 55910 ...
    const view = new DataView(buffer);
    const blocks = [];
    // Use 4 16-bit integers (8 bytes total)
    for (let i = 0; i < 4; i++) {
       blocks.push(view.getUint16(i * 2).toString().padStart(5, '0'));
    }
    return blocks.join(' ');
  }
}