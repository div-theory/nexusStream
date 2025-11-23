
export class MediaService {
  /**
   * ROBUST GET USER MEDIA
   * Tries multiple constraint strategies to ensure we get a stream.
   */
  static async getRobustStream(): Promise<MediaStream> {
    const strategies = [
      { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true },
      { video: true, audio: true },
      { video: { width: { ideal: 320 }, height: { ideal: 240 } }, audio: true }
    ];

    let lastError: any;

    for (const constraints of strategies) {
      try {
        console.log("MediaService: Requesting constraints:", constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("MediaService: Stream acquired successfully.");
        return stream;
      } catch (err: any) {
        console.warn("MediaService: Strategy failed", err.name, constraints);
        lastError = err;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') throw err;
      }
    }

    try {
      console.warn("MediaService: All video strategies failed. Trying Audio Only.");
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return audioStream;
    } catch (err) {
      console.error("MediaService: Audio fallback failed.");
    }

    throw lastError || new Error("Could not acquire media stream");
  }

  /**
   * Get list of available media devices
   */
  static async getDevices(): Promise<{ audio: MediaDeviceInfo[], video: MediaDeviceInfo[] }> {
    try {
      // Ensure permissions are granted first by requesting a temporary stream if necessary
      // (Browsers often hide labels until permission is granted)
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        audio: devices.filter(d => d.kind === 'audioinput'),
        video: devices.filter(d => d.kind === 'videoinput')
      };
    } catch (e) {
      console.error("Failed to enumerate devices", e);
      return { audio: [], video: [] };
    }
  }

  /**
   * Get stream using specific device IDs
   */
  static async getStreamWithDeviceId(audioDeviceId?: string, videoDeviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  static getErrorMessage(err: any): string {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return "Permission Denied. Please allow camera/mic access in your browser settings.";
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return "No camera or microphone found on this device.";
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return "Hardware in use. Please close other apps using the camera/mic.";
    }
    if (err.name === 'OverconstrainedError') {
      return "Camera constraints not satisfied. Retrying with defaults...";
    }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        return "Insecure Context: Camera requires HTTPS. Please use a secure connection.";
    }
    return `Media Error: ${err.message || err.name}`;
  }
}
