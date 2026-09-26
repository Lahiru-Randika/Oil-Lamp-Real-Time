import { useEffect, useRef, useState } from "react";
import {
  RotateCcw,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { signInAnonymously } from "firebase/auth";
import { onValue, ref, runTransaction } from "firebase/database";
import { auth, db, CEREMONY_ID } from "./firebase";
import "./style.css";

const ART_WIDTH = 2048;
const ART_HEIGHT = 1152;

// x = horizontal flame center, y = wick/base position, h = flame height.
const LEFT_CUPS = [
  { x: 575, y: 72, h: 59 },
  { x: 510, y: 165, h: 69 },
  { x: 449, y: 274, h: 72 },
  { x: 580, y: 317, h: 70 },
  { x: 410, y: 379, h: 73 },
  { x: 395, y: 495, h: 73 },
  { x: 533, y: 498, h: 73 },
  { x: 395, y: 606, h: 74 },
  { x: 417, y: 720, h: 75 },
  { x: 535, y: 703, h: 75 },
];

const LAMPS = [
  ...LEFT_CUPS.map((cup, i) => ({ ...cup, id: `left-${i}` })),
  ...LEFT_CUPS.map((cup, i) => ({
    ...cup,
    x: ART_WIDTH - cup.x,
    id: `right-${i}`,
  })),
  {
    x: 1025,
    y: 899,
    h: 151,
    id: "center",
    center: true,
  },
];

// Center first, then alternate left/right from the bottom upward.
const ORDER = [LAMPS.length - 1];
for (let i = LEFT_CUPS.length - 1; i >= 0; i -= 1) {
  ORDER.push(i, i + LEFT_CUPS.length);
}

const MAX_LAMPS = ORDER.length;
const COMPACT_MEDIA = "(max-width: 1024px)";
const percent = (value, total) => `${(value / total) * 100}%`;
const isCompactScreen = () =>
  typeof window !== "undefined" && window.matchMedia(COMPACT_MEDIA).matches;

const AMBIENT_EMBERS = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  left: `${4 + ((i * 6.1) % 92)}%`,
  delay: `${(i * 0.42) % 7}s`,
  duration: `${8 + (i % 6) * 1.1}s`,
  size: `${2 + (i % 4)}px`,
  drift: `${(i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 5)}px`,
}));

export default function App() {
  const [litCount, setLitCount] = useState(0);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [firebaseError, setFirebaseError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(
    Boolean(document.fullscreenElement)
  );
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(35);
  const [soundOpen, setSoundOpen] = useState(false);
  const [musicError, setMusicError] = useState(false);

  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsTimerRef = useRef(null);
  // Mobile/Tablet Fire Burst & Debounce state
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [burstActive, setBurstActive] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  const musicRef = useRef(null);
  const lightRef = useRef(null);
  const mutedByUser = useRef(false);
  const lastTouchRef = useRef(null);
  const previousRemoteCountRef = useRef(null);
  const hasReceivedInitialStateRef = useRef(false);
  const debounceTimerRef = useRef(null);

  const litCountRef = ref(db, `ceremonies/${CEREMONY_ID}/litCount`);

  const [highlightedLamp, setHighlightedLamp] = useState(null);
  const highlightTimerRef = useRef(null);

  // Fullscreen state.
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Background music setup.
  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;

    audio.volume = musicVolume / 100;
    audio.loop = true;

    const onPlay = () => {
      setMusicPlaying(true);
      setMusicError(false);
    };
    const onPause = () => setMusicPlaying(false);
    const onError = () => setMusicError(true);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    const compact = window.matchMedia(COMPACT_MEDIA);
    const syncMusicToScreen = () => {
      if (compact.matches) {
        audio.pause();
        return;
      }
      if (!mutedByUser.current) {
        audio.play().catch(() => {});
      }
    };

    syncMusicToScreen();
    compact.addEventListener("change", syncMusicToScreen);

    return () => {
      compact.removeEventListener("change", syncMusicToScreen);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, []);

  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = musicVolume / 100;
    }
  }, [musicVolume]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const showControls = () => {
    setControlsVisible(true);

    // Clear the previous timer
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }

    // Hide after 5 seconds without interaction
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 5000);
  };

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, []);

  // Sign in anonymously, then subscribe to the shared Realtime Database value.
  useEffect(() => {
    let unsubscribeDatabase = null;
    let cancelled = false;

    const connect = async () => {
      try {
        await signInAnonymously(auth);
        if (cancelled) return;

        // Initialize the shared value only when it does not exist yet.
        await runTransaction(litCountRef, (current) => {
          if (current === null) return 0;
          const value = Number(current);
          if (!Number.isFinite(value)) return 0;
          return Math.max(0, Math.min(MAX_LAMPS, Math.floor(value)));
        });

        if (cancelled) return;

        unsubscribeDatabase = onValue(
          litCountRef,
          (snapshot) => {
            const raw = Number(snapshot.val() ?? 0);
            const nextCount = Math.max(
              0,
              Math.min(MAX_LAMPS, Number.isFinite(raw) ? Math.floor(raw) : 0)
            );

            const previous = previousRemoteCountRef.current;
            setLitCount(nextCount);
            setFirebaseReady(true);
            setFirebaseError("");

            // Play the short lighting sound for new remote increments
            if (
              !isCompactScreen() &&
              hasReceivedInitialStateRef.current &&
              previous !== null &&
              nextCount > previous
            ) {
              const sound = lightRef.current;
              if (sound) {
                try {
                  sound.pause();
                  sound.currentTime = 0;
                  sound.volume = 0.58;
                  sound.play().catch(() => {});
                } catch {
                  // Audio is optional; synchronization must continue.
                }
              }
            }

            previousRemoteCountRef.current = nextCount;
            hasReceivedInitialStateRef.current = true;
          },
          (error) => {
            console.error("Realtime Database listener failed:", error);
            setFirebaseReady(false);
            setFirebaseError("Realtime sync unavailable");
          }
        );
      } catch (error) {
        console.error("Firebase connection failed:", error);
        setFirebaseReady(false);
        setFirebaseError("Firebase connection failed");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (unsubscribeDatabase) unsubscribeDatabase();
    };
  }, []);

  const startMusic = () => {
    const audio = musicRef.current;
    if (!audio || mutedByUser.current || !audio.paused) return;

    audio
      .play()
      .then(() => setMusicError(false))
      .catch(() => setMusicError(true));
  };

  // Atomic global increment with fire burst animation and debounce guard
  const lightNext = async () => {
    if (!firebaseReady || litCount >= MAX_LAMPS || isDebouncing) return;

    // 1. Standard Haptic Feedback
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(50);
      } catch {}
    }

    // 2. Immediate audio feedback
    if (!isCompactScreen() && lightRef.current) {
      try {
        lightRef.current.currentTime = 0;
        lightRef.current.volume = 0.65;
        lightRef.current.play().catch(() => {});
      } catch {}
    }

    if (!isCompactScreen()) {
      startMusic();
    }

    // 3. Trigger Fire Burst animation & debounce lock
    setBurstActive(true);
    setBurstKey((prev) => prev + 1);
    setIsDebouncing(true);

    try {
      await runTransaction(litCountRef, (current) => {
        const currentCount = Math.max(
          0,
          Math.min(MAX_LAMPS, Number(current ?? 0) || 0)
        );

        if (currentCount >= MAX_LAMPS) {
          return currentCount;
        }

        return currentCount + 1;
      });
      setFirebaseError("");
    } catch (error) {
      console.error("Unable to light the next lamp:", error);
      setFirebaseError("Could not sync lamp");
    } finally {
      // 1.6s debounce window & burst cleanup
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        setIsDebouncing(false);
        setBurstActive(false);
      }, 1600);
    }
  };

  // Reset is also global: every connected device returns to zero lamps.
  const resetLamps = async () => {
    if (!firebaseReady) return;

    try {
      await runTransaction(litCountRef, () => 0);
      setFirebaseError("");
    } catch (error) {
      console.error("Unable to reset lamps:", error);
      setFirebaseError("Could not reset ceremony");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn("Fullscreen unavailable:", error);
    }
  };

  // Touch: normal tap does nothing; double tap toggles fullscreen.
  const handleScenePointerUp = (event) => {
    if (event.pointerType === "mouse") return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;

    const now = Date.now();
    const previous = lastTouchRef.current;

    if (
      previous &&
      now - previous.time < 370 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 45
    ) {
      lastTouchRef.current = null;
      void toggleFullscreen();
      return;
    }

    lastTouchRef.current = {
      time: now,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleMusic = async () => {
    const audio = musicRef.current;
    if (!audio) return;

    if (audio.paused) {
      mutedByUser.current = false;
      try {
        await audio.play();
        setMusicError(false);
      } catch {
        setMusicError(true);
      }
    } else {
      mutedByUser.current = true;
      audio.pause();
    }
  };

  const litSet = new Set(ORDER.slice(0, litCount));
  const complete = litCount >= MAX_LAMPS;

  const getButtonLabel = () => {
    if (!firebaseReady) return "Connecting Ceremony...";
    if (complete) return "All Lamps Lit";
    if (isDebouncing) return "Lamp Lit";
    return "Light the Lamp";
  };

  return (
    <main className={`app-shell${complete ? " ceremony-complete" : ""}`}>
      <audio ref={musicRef} src="/sounds/background.mp3" preload="auto" loop />
      <audio ref={lightRef} src="/sounds/light.mp3" preload="auto" />

      <div className="mobile-atmosphere" aria-hidden="true">
        <div className="mobile-vignette" />
        <div className="mobile-heat-haze" />
        <div className="mobile-glow-orb mobile-glow-orb-a" />
        <div className="mobile-glow-orb mobile-glow-orb-b" />
        <div className="mobile-glow-orb mobile-glow-orb-c" />
        <div className="mobile-ember-field">
          {AMBIENT_EMBERS.map((ember) => (
            <span
              key={ember.id}
              className="ambient-ember"
              style={{
                left: ember.left,
                "--delay": ember.delay,
                "--duration": ember.duration,
                "--size": ember.size,
                "--drift": ember.drift,
              }}
            />
          ))}
        </div>
      </div>

      {/* Stage visual elements (Hidden on mobile & tablet, completely untouched on desktop) */}
      <section className="stage-wrapper" aria-label="Digital oil lamp ceremony">
        <div
          className="scene"
          onDoubleClick={(event) => {
            if (event.nativeEvent.sourceCapabilities?.firesTouchEvents) return;
            void toggleFullscreen();
          }}
          onPointerUp={handleScenePointerUp}
          title={
            isFullscreen
              ? "Double-click to exit fullscreen"
              : "Double-click to enter fullscreen"
          }
        >
          <img
            className="scene-image"
            src="/cultural-tourism-stage.png"
            alt="Digital Innovation for Sustainable Cultural Tourism 2026 silver oil lamp artwork"
            draggable={false}
          />

          {LAMPS.map((lamp, index) => {
            const isLit = litSet.has(index);

            return (
              <div
                key={lamp.id}
                className={`flame-anchor${isLit ? " active" : ""}${
                  lamp.center ? " center-flame" : ""
                }`}
                style={{
                  left: percent(lamp.x, ART_WIDTH),
                  top: percent(lamp.y - lamp.h, ART_HEIGHT),
                  height: percent(lamp.h, ART_HEIGHT),
                  "--delay": `${(index % 6) * -0.16}s`,
                }}
                aria-hidden="true"
              >
                {isLit && (
                  <>
                    <span className="flame-halo" />
                    <img
                      className="flame-image"
                      src="/flame.gif"
                      alt=""
                      draggable={false}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Interactive Action Area */}
      <section className="ceremony-bar" aria-label="Ceremony lighting control">
        {/* Fire Burst / Spark Background Animation (Mobile/Tablet Only) */}
        {burstActive && (
          <div className="mobile-fire-burst" key={burstKey} aria-hidden="true">
            <div className="burst-radial-glow" />
            <div className="burst-flash" />
            <div className="burst-ring" />
            <div className="burst-ring burst-ring-delayed" />
            <div className="burst-ring burst-ring-late" />
            <div className="burst-spark-cluster">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="burst-spark"
                  style={{
                    "--rot": `${i * 15}deg`,
                    "--dist": `${70 + (i % 5) * 38}px`,
                    "--delay": `${(i % 5) * 0.03}s`,
                    "--size": `${3 + (i % 4) * 2.5}px`,
                  }}
                />
              ))}
            </div>
            <div className="burst-ember-rise">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className="burst-rising-ember"
                  style={{
                    "--x": `${-90 + i * 20}px`,
                    "--delay": `${0.05 + (i % 4) * 0.06}s`,
                    "--rise": `${110 + (i % 3) * 40}px`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div
          className={`button-wrapper${burstActive ? " is-bursting" : ""}${complete ? " is-complete" : ""}`}
        >
          

          {/* <p className="mobile-helper-text">
            {complete
              ? "Every lamp is glowing"
              : "Tap below to light the oil lamp"}
          </p> */}

          

          <button
            className={`light-button${isDebouncing ? " debouncing" : ""}${complete ? " complete" : ""}`}
            onClick={lightNext}
            disabled={!firebaseReady || complete || isDebouncing}
            type="button"
            title={firebaseError || undefined}
          >
            <span className="button-sheen" aria-hidden="true" />
            <span className="button-text-label">{getButtonLabel()}</span>
          </button>
        </div>
      </section>

      {/* Floating Controls (Desktop only) */}
      <aside
        className={`floating-controls ${
          controlsVisible ? "controls-visible" : ""
        }`}
        aria-label="Audio and reset controls"
        onPointerEnter={showControls}
        onPointerMove={showControls}
        onPointerDown={showControls}
        onFocusCapture={showControls}
      >
        {soundOpen && (
          <div className="volume-panel">
            <label htmlFor="music-volume">
              Music volume <strong>{musicVolume}%</strong>
            </label>
            <input
              id="music-volume"
              type="range"
              min="0"
              max="100"
              step="1"
              value={musicVolume}
              onChange={(event) => setMusicVolume(Number(event.target.value))}
              aria-label="Music volume"
            />
            {(musicError || firebaseError) && (
              <span className="audio-warning">
                {firebaseError || "Check background.mp3"}
              </span>
            )}
          </div>
        )}

        <button
          className="round-control reset-control"
          onClick={resetLamps}
          disabled={!firebaseReady || litCount === 0}
          aria-label="Extinguish all lamps on every connected device"
          title="Extinguish all lamps on every connected device"
          type="button"
        >
          <RotateCcw size={21} />
        </button>

        <button
          className="round-control volume-toggle"
          onClick={() => setSoundOpen((open) => !open)}
          aria-expanded={soundOpen}
          aria-label="Show volume adjustment"
          title="Adjust volume"
          type="button"
        >
          {soundOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>

        <button
          className="round-control sound-control"
          onClick={handleMusic}
          aria-label={musicPlaying ? "Mute music" : "Play music"}
          aria-pressed={musicPlaying}
          title={musicPlaying ? "Mute music" : "Play music"}
          type="button"
        >
          {musicPlaying ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>
      </aside>
    </main>
  );
}