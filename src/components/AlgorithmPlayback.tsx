import { useEffect, useId, useReducer, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack, StepBack, StepForward } from 'lucide-react';
import { initialPlayback, playbackReducer } from '../lib/playback';

export function useAlgorithmPlayback({
  totalSteps,
  resetKey,
  defaultDelay = 700,
  stepDelay,
}: {
  totalSteps: number;
  resetKey: string;
  defaultDelay?: number;
  stepDelay?: (step: number) => number;
}) {
  const total = Math.max(0, Math.floor(totalSteps));
  const runKey = JSON.stringify([resetKey, total]);
  const [stored, dispatch] = useReducer(playbackReducer, initialPlayback(runKey, total));
  const [speed, setSpeed] = useState(1);
  const state = stored.runKey === runKey ? stored : initialPlayback(runKey, total);
  const { step, playing } = state;

  useEffect(() => {
    dispatch({ type: 'reset', runKey, totalSteps: total });
  }, [runKey, total]);

  const delay = stepDelay?.(step) ?? defaultDelay;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'tick', runKey, totalSteps: total }),
      delay / speed,
    );
    return () => window.clearTimeout(timer);
  }, [playing, step, runKey, total, delay, speed]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) dispatch({ type: 'pause', runKey, totalSteps: total });
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [runKey, total]);

  const seek = (value: number) =>
    dispatch({ type: 'seek', runKey, totalSteps: total, step: value });
  return {
    step,
    playing,
    speed,
    totalSteps: total,
    setSpeed,
    toggle: () => dispatch({ type: 'toggle', runKey, totalSteps: total }),
    reset: () => dispatch({ type: 'reset', runKey, totalSteps: total }),
    seek,
    next: () => seek(step + 1),
    previous: () => seek(step - 1),
    finished: total > 0 && step === total,
  };
}

export function PlaybackControls({
  playback,
  label,
  disabled = false,
}: {
  playback: ReturnType<typeof useAlgorithmPlayback>;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const { step, totalSteps, playing, finished } = playback;
  const unavailable = disabled || totalSteps === 0;
  return (
    <div className="algorithm-player" role="group" aria-label={`${label} playback`}>
      <div className="algorithm-player-actions">
        <button
          type="button"
          className="primary algorithm-play"
          onClick={playback.toggle}
          disabled={unavailable}
          aria-label={`${playing ? 'Pause' : finished ? 'Replay' : 'Play'} ${label}`}
        >
          {playing ? <Pause size={16} /> : finished ? <RotateCcw size={16} /> : <Play size={16} />}
          {playing ? 'Pause' : finished ? 'Replay' : step > 0 ? 'Resume' : 'Play algorithm'}
        </button>
        <div className="algorithm-step-buttons">
          <button
            type="button"
            className="outline"
            onClick={playback.reset}
            disabled={unavailable || step === 0}
            aria-label={`Restart ${label}`}
            title="Restart"
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className="outline"
            onClick={playback.previous}
            disabled={unavailable || step === 0}
            aria-label={`Previous ${label} step`}
            title="Previous step"
          >
            <StepBack size={16} />
          </button>
          <button
            type="button"
            className="outline"
            onClick={playback.next}
            disabled={unavailable || finished}
            aria-label={`Next ${label} step`}
            title="Next step"
          >
            <StepForward size={16} />
          </button>
        </div>
        <label className="algorithm-speed" htmlFor={`${id}-speed`}>
          Speed
          <select
            id={`${id}-speed`}
            value={playback.speed}
            onChange={(event) => playback.setSpeed(Number(event.target.value))}
            disabled={unavailable}
          >
            {[0.5, 1, 2, 4].map((speed) => (
              <option value={speed} key={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="algorithm-timeline">
        <label htmlFor={`${id}-timeline`}>
          {unavailable ? 'No steps available' : `Step ${step} of ${totalSteps}`}
        </label>
        <input
          id={`${id}-timeline`}
          type="range"
          min={0}
          max={totalSteps}
          value={step}
          disabled={unavailable}
          onChange={(event) => playback.seek(Number(event.target.value))}
          aria-label={`${label} timeline`}
          aria-valuetext={`Step ${step} of ${totalSteps}`}
        />
        <span
          className={`algorithm-playback-status ${finished ? 'is-complete' : ''}`}
          role="status"
        >
          {unavailable
            ? 'Unavailable'
            : playing
              ? 'Playing'
              : finished
                ? 'Complete'
                : step > 0
                  ? 'Paused'
                  : 'Ready to play'}
        </span>
      </div>
    </div>
  );
}
