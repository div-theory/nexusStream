interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Service to manage ICE (STUN/TURN) Server configuration.
 * 
 * Default: Uses Google's Public STUN servers.
 * Production: Fetches secure TURN credentials from your backend if configured.
 */
export class TurnService {
  // Replace with your actual backend endpoint when deployed
  private static TURN_API_ENDPOINT = process.env.REACT_APP_TURN_API || ''; 

  static getDefaultIceServers(): IceServer[] {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ];
  }

  /**
   * Fetches ephemeral TURN credentials from the backend.
   * If the fetch fails or no endpoint is configured, returns default Public STUN servers.
   */
  static async getIceServers(userId: string): Promise<IceServer[]> {
    // 1. If no API endpoint is configured, use Public STUN (Development/Fallback)
    if (!this.TURN_API_ENDPOINT) {
      console.log("TURN Service: No API endpoint configured. Using Public STUN.");
      return this.getDefaultIceServers();
    }

    try {
      console.log("TURN Service: Fetching secure credentials...");
      // Example fetch - adjust headers/body based on your auth implementation
      const response = await fetch(this.TURN_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error(`Auth failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Expected format from server/turnHelper.js: { username, credential, urls: [] }
      if (data.username && data.credential && data.urls) {
        return [{
          urls: data.urls,
          username: data.username,
          credential: data.credential
        }];
      }
      
      return this.getDefaultIceServers();

    } catch (error) {
      console.warn("TURN Service: Failed to fetch credentials. Falling back to STUN.", error);
      return this.getDefaultIceServers();
    }
  }
}