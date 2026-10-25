export type PlaybackState = {
  runKey: string;
  totalSteps: number;
  step: number;
  playing: boolean;
};

type PlaybackAction = {
  type: 'toggle' | 'tick' | 'reset' | 'seek' | 'pause';
  runKey: string;
  totalSteps: number;
  step?: number;
};

export function initialPlayback(runKey: string, totalSteps: number): PlaybackState {
  return { runKey, totalSteps, step: 0, playing: false };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  const sameRun = state.runKey === action.runKey && state.totalSteps === action.totalSteps;
  // An already queued timer from the previous input must never advance a new demonstration.
  if (action.type === 'tick' && !sameRun) return state;
  const current = sameRun ? state : initialPlayback(action.runKey, action.totalSteps);
  switch (action.type) {
    case 'reset':
      return initialPlayback(action.runKey, action.totalSteps);
    case 'pause':
      return { ...current, playing: false };
    case 'seek':
      return {
        ...current,
        step: Math.max(0, Math.min(current.totalSteps, Math.round(action.step ?? 0))),
        playing: false,
      };
    case 'toggle': {
      if (!current.totalSteps) return current;
      if (current.playing) return { ...current, playing: false };
      const step = current.step === current.totalSteps ? 1 : Math.max(1, current.step);
      return { ...current, step, playing: step < current.totalSteps };
    }
    case 'tick': {
      if (!current.playing) return current;
      const step = Math.min(current.totalSteps, current.step + 1);
      return { ...current, step, playing: step < current.totalSteps };
    }
  }
}
