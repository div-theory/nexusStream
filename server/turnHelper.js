/**
 * TURN CREDENTIAL GENERATOR (Node.js)
 * 
 * Usage: Import this module in your backend API (e.g., Express, Vercel Function).
 * Call `generateTurnCredentials` when a user requests access to initiate a call.
 * 
 * Requirement: 
 * - Set process.env.TURN_STATIC_SECRET (from your coturn config)
 * - Set process.env.TURN_URI (e.g., "turn:turn.yourdomain.com:3478")
 */

const crypto = require('crypto');

/**
 * Generates secure, short-lived credentials for a TURN server using the REST API mechanism.
 * 
 * @param {string} userId - Unique identifier for the user (for logging/debugging on server).
 * @param {number} ttlSeconds - How long the credential is valid (default 300s / 5m).
 * @returns {object} - { username, credential, urls }
 */
function generateTurnCredentials(userId, ttlSeconds = 300) {
  const secret = process.env.TURN_STATIC_SECRET;
  const domainURI = process.env.TURN_URI;

  if (!secret || !domainURI) {
    console.warn("TURN_STATIC_SECRET or TURN_URI not set. Returning empty credentials.");
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${timestamp}:${userId}`;
  
  // Create HMAC-SHA1 signature
  const hmac = crypto.createHmac('sha1', secret);
  hmac.setEncoding('base64');
  hmac.write(username);
  hmac.end();
  const credential = hmac.read();

  return {
    username: username,
    credential: credential,
    urls: [
        `stun:${domainURI.split(':')[1] || domainURI}`, // Derive stun from turn URI if possible
        `${domainURI}?transport=udp`,
        `${domainURI}?transport=tcp`
        // Add turns: (TLS) if configured
    ]
  };
}

module.exports = { generateTurnCredentials };