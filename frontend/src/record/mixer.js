/**
 * Web Audio graph for the recorder:
 *
 *   mic ──► micAnalyser (level meter, before mute)
 *     └──► micGain (0 when muted) ──┬──► destination ──► MediaRecorder
 *   shared tab/system audio ────────┤
 *                                   └──► mixAnalyser (waveform)
 *
 * The destination's stream never changes, so the mic device can be swapped and sharing
 * started or stopped in the middle of a recording without restarting MediaRecorder.
 */
export function createMixer() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const destination = ctx.createMediaStreamDestination();

  const micGain = ctx.createGain();
  const micAnalyser = ctx.createAnalyser();
  micAnalyser.fftSize = 512;
  const mixAnalyser = ctx.createAnalyser();
  mixAnalyser.fftSize = 2048;

  micGain.connect(destination);
  micGain.connect(mixAnalyser);

  let micSource = null;
  let shareSource = null;

  return {
    ctx,
    stream: destination.stream,
    micAnalyser,
    mixAnalyser,

    /** Plug in a new microphone stream (or null to unplug). */
    setMic(stream) {
      micSource?.disconnect();
      micSource = null;
      if (!stream) return;
      micSource = ctx.createMediaStreamSource(stream);
      micSource.connect(micAnalyser);
      micSource.connect(micGain);
    },

    /** Plug in the audio of a getDisplayMedia stream, if it has any. Returns true when it did. */
    setShare(stream) {
      shareSource?.disconnect();
      shareSource = null;
      const tracks = stream?.getAudioTracks() || [];
      if (!tracks.length) return false;
      shareSource = ctx.createMediaStreamSource(new MediaStream(tracks));
      shareSource.connect(destination);
      shareSource.connect(mixAnalyser);
      return true;
    },

    setMuted(muted) {
      // A short ramp avoids the click a hard 1 -> 0 jump makes in the recording.
      micGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
    },

    /** Browsers start an AudioContext suspended until a click; every control calls this. */
    resume() {
      return ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
    },

    close() {
      micSource?.disconnect();
      shareSource?.disconnect();
      ctx.close().catch(() => {});
    },
  };
}

/** 0..1 loudness of whatever feeds `analyser`, from its time-domain samples (RMS, scaled). */
export function level(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}
