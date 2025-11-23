
export class MediaService {
  /**
   * ROBUST GET USER MEDIA
   * Tries multiple constraint strategies to ensure we get a stream.
   * 1. Ideal (User Facing, HD)
   * 2. Basic (Any Video)
   * 3. Audio Only (Last Resort)
   */
  static async getRobustStream(): Promise<MediaStream> {
    const strategies = [
      // Strategy 1: Ideal Mobile Config (User facing, 720p)
      { 
        video: { 
          facingMode: 'user', 
          width: { ideal: 1280 }, 
          height: { ideal: 720 } 
        }, 
        audio: true 
      },
      // Strategy 2: Relaxed Video (Any camera, standard def)
      { 
        video: true, 
        audio: true 
      },
      // Strategy 3: Low Bandwidth Video
      { 
        video: { 
          width: { ideal: 320 }, 
          height: { ideal: 240 } 
        }, 
        audio: true 
      }
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
        
        // If permission is explicitly denied, stop trying and throw immediately
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw err;
        }
      }
    }

    // Strategy 4: Audio Only (If video is impossible/broken hardware)
    try {
      console.warn("MediaService: All video strategies failed. Trying Audio Only.");
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return audioStream;
    } catch (err) {
      console.error("MediaService: Audio fallback failed.");
    }

    throw lastError || new Error("Could not acquire media stream");
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
