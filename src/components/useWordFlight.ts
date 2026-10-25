import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function useWordFlight({
  sourceRef: wordRef,
  targetRef: destinationRef,
  containerRef: workbenchRef,
  tokenRef: flightRef,
  active,
  runKey,
  speed,
  playing,
  finished,
}: {
  sourceRef: RefObject<HTMLElement | null>;
  targetRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  tokenRef: RefObject<HTMLElement | null>;
  active: boolean;
  runKey: string;
  speed: number;
  playing: boolean;
  finished: boolean;
}) {
  const animationRef = useRef<Animation | null>(null);
  const wasPlaying = useRef(false);
  useLayoutEffect(() => {
    const source = wordRef.current;
    const destination = destinationRef.current;
    const token = flightRef.current;
    const workbench = workbenchRef.current;
    if (!active || !source || !destination || !token || !workbench) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = source.getBoundingClientRect();
    const end = destination.getBoundingClientRect();
    const area = workbench.getBoundingClientRect();
    token.style.left = `${start.left - area.left}px`;
    token.style.top = `${start.top - area.top}px`;
    token.style.width = `${start.width}px`;
    token.style.height = `${start.height}px`;
    token.style.visibility = 'visible';
    source.style.visibility = 'hidden';
    destination.style.visibility = 'hidden';
    const animation = token.animate(
      [
        { transform: 'translate(0, 0)', background: '#fff7db', borderColor: '#b88026' },
        {
          transform: `translate(${(end.left - start.left) * 0.5}px, ${(end.top - start.top) * 0.5 - 28}px)`,
          offset: 0.5,
        },
        {
          transform: `translate(${end.left - start.left}px, ${end.top - start.top}px)`,
          background: '#28513a',
          color: '#fff',
          borderColor: '#28513a',
          width: `${end.width}px`,
          height: `${end.height}px`,
        },
      ],
      { duration: 1100, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
    );
    animation.playbackRate = speed;
    animationRef.current = animation;
    const land = () => {
      token.style.visibility = 'hidden';
      destination.style.visibility = '';
    };
    animation.onfinish = land;
    // Finish at the correct slot if the layout changes during a flight.
    const resize = () => {
      animation.finish();
    };
    window.addEventListener('resize', resize);
    return () => {
      animation.cancel();
      animationRef.current = null;
      token.style.visibility = 'hidden';
      source.style.visibility = '';
      destination.style.visibility = '';
      window.removeEventListener('resize', resize);
    };
  }, [active, runKey]);

  useEffect(() => {
    animationRef.current?.updatePlaybackRate(speed);
  }, [speed]);

  useEffect(() => {
    const animation = animationRef.current;
    if (playing && animation?.playState === 'paused') animation.play();
    if (wasPlaying.current && !playing && !finished) animation?.pause();
    wasPlaying.current = playing;
  }, [playing, finished]);
}
