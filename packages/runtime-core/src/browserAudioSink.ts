import type { AudioPlayback, AudioSink, AudioSource } from "./types";

function isBrowserAudioAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Audio !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

/**
 * AudioSink backed by HTMLAudioElement. In a non-browser environment `play`
 * resolves immediately so the session degrades gracefully (no audio, but the
 * playback lifecycle still settles).
 *
 * Ownership: the sink revokes any `blob:` object URL it plays (whether created
 * here from `bytes` or handed in via `src.url`) when the clip ends, errors, is
 * stopped, or is replaced by a newer clip.
 */
export function createBrowserAudioSink(): AudioSink {
  let currentAudio: HTMLAudioElement | null = null;
  let ownedUrl: string | null = null;
  let currentSettle: (() => void) | null = null;

  function releaseUrl() {
    if (ownedUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try {
        URL.revokeObjectURL(ownedUrl);
      } catch {
        // Revoking is best-effort.
      }
    }
    ownedUrl = null;
  }

  function endCurrent() {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      try {
        currentAudio.pause();
      } catch {
        // Pausing a not-yet-started clip can throw; ignore.
      }
      currentAudio.src = "";
      currentAudio = null;
    }
    releaseUrl();
    const settle = currentSettle;
    currentSettle = null;
    settle?.();
  }

  return {
    async play(src: AudioSource): Promise<AudioPlayback> {
      if (!isBrowserAudioAvailable()) {
        return { durationSec: 0, finished: Promise.resolve() };
      }

      // Stop and settle any clip already playing before starting the new one.
      endCurrent();

      let url = src.url;
      if (!url && src.bytes) {
        url = URL.createObjectURL(new Blob([src.bytes]));
      }
      if (!url) {
        return { durationSec: 0, finished: Promise.resolve() };
      }
      if (url.startsWith("blob:")) ownedUrl = url;

      const audio = new Audio(url);
      currentAudio = audio;

      const finished = new Promise<void>((resolve) => {
        currentSettle = resolve;
      });
      const handleEnd = () => {
        if (currentAudio === audio) endCurrent();
      };
      audio.onended = handleEnd;
      audio.onerror = handleEnd;

      try {
        await audio.play();
      } catch {
        if (currentAudio === audio) endCurrent();
        return { durationSec: 0, finished };
      }

      const durationSec = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      return { durationSec, finished };
    },
    stop() {
      if (!isBrowserAudioAvailable()) return;
      endCurrent();
    }
  };
}
