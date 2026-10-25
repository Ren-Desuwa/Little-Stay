import { describe, expect, it } from 'vitest';
import { initialPlayback, playbackReducer } from './playback';

describe('algorithm playback lifecycle', () => {
  const context = { runKey: 'first', totalSteps: 3 };
  const initial = () => initialPlayback(context.runKey, context.totalSteps);

  it('starts immediately, pauses without advancing, and resumes to completion', () => {
    let state = playbackReducer(initial(), { ...context, type: 'toggle' });
    expect(state).toMatchObject({ step: 1, playing: true });
    state = playbackReducer(state, { ...context, type: 'toggle' });
    expect(state).toMatchObject({ step: 1, playing: false });
    expect(playbackReducer(state, { ...context, type: 'tick' })).toEqual(state);
    state = playbackReducer(state, { ...context, type: 'toggle' });
    state = playbackReducer(state, { ...context, type: 'tick' });
    state = playbackReducer(state, { ...context, type: 'tick' });
    expect(state).toMatchObject({ step: 3, playing: false });
    expect(playbackReducer(state, { ...context, type: 'toggle' })).toMatchObject({
      step: 1,
      playing: true,
    });
  });

  it('pauses scrubbing, clamps the timeline, and resets', () => {
    const playing = playbackReducer(initial(), { ...context, type: 'toggle' });
    expect(playbackReducer(playing, { ...context, type: 'seek', step: 99 })).toMatchObject({
      step: 3,
      playing: false,
    });
    expect(playbackReducer(playing, { ...context, type: 'seek', step: -1 }).step).toBe(0);
    expect(playbackReducer(playing, { ...context, type: 'reset' })).toEqual(initial());
    expect(playbackReducer(playing, { ...context, type: 'pause' })).toMatchObject({
      step: 1,
      playing: false,
    });
  });

  it('discards stale ticks after inputs or step counts change', () => {
    const previous = playbackReducer(initial(), { ...context, type: 'toggle' });
    const nextContext = { runKey: 'changed', totalSteps: 2 };
    const changed = playbackReducer(previous, { ...nextContext, type: 'reset' });
    expect(playbackReducer(changed, { ...context, type: 'tick' })).toEqual(changed);
    expect(playbackReducer(previous, { ...context, totalSteps: 5, type: 'toggle' })).toMatchObject({
      totalSteps: 5,
      step: 1,
      playing: true,
    });
  });

  it('handles no steps and one-step runs without a live timer', () => {
    const empty = { runKey: 'empty', totalSteps: 0 };
    expect(
      playbackReducer(initialPlayback('empty', 0), { ...empty, type: 'toggle' }),
    ).toMatchObject({
      step: 0,
      playing: false,
    });
    const single = { runKey: 'single', totalSteps: 1 };
    expect(
      playbackReducer(initialPlayback('single', 1), { ...single, type: 'toggle' }),
    ).toMatchObject({
      step: 1,
      playing: false,
    });
  });
});
