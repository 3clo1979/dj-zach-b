'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const photos = [
  {
    id: 'wedding',
    title: 'Wedding celebration',
    src: '/images/wedding.webp',
    alt: 'A couple celebrating their wedding beside sparkling lights',
    width: 506,
    height: 1218,
  },
  {
    id: 'zach',
    title: 'Zach behind the music',
    src: '/images/zach-at-the-decks.webp',
    alt: 'DJ Zach B in a red shirt and black hat mixing music at a wedding reception',
    width: 1223,
    height: 1286,
  },
] as const;

export default function HeroCarousel() {
  const [active, setActive] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const running = autoPlay && !hovered && !focusWithin && pageVisible;

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    // A new reduced-motion preference stops rotation; only Play starts it again.
    const updateMotion = () => { if (motion.matches) setAutoPlay(false); };
    setAutoPlay(!motion.matches);
    updateVisibility();
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    // One timeout per visible photo; every resume gets a fresh four seconds.
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        setActive(current => (current + 1) % photos.length);
      } else {
        setPageVisible(false);
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [running, active]);

  function selectPhoto(index: number) {
    setAutoPlay(false);
    setActive(index);
  }

  function togglePlayback() {
    // Explicit Play opts back in without moving focus. A new focus event pauses again.
    if (!autoPlay) setFocusWithin(false);
    setAutoPlay(current => !current);
  }

  function selectWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Leave browser/assistive-technology shortcuts (for example Ctrl+Home) alone.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % photos.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + photos.length) % photos.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = photos.length - 1;
    else return;
    event.preventDefault();
    selectPhoto(next);
    buttons.current[next]?.focus();
  }

  function startGesture(event: PointerEvent<HTMLDivElement>) {
    gesture.current = null;
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    if ((event.target as HTMLElement).closest('button')) return;
    setAutoPlay(false);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function finishGesture(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Vertical movement and short taps belong to the page, not the carousel.
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.4) return;
    setActive(current => (current + (dx < 0 ? 1 : -1) + photos.length) % photos.length);
  }

  return (
    <div
      className="hero-photo hero-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Celebrations with DJ Zach B"
      onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
      onPointerLeave={event => { if (event.pointerType !== 'touch') setHovered(false); }}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onPointerDown={startGesture}
      onPointerUp={finishGesture}
      onPointerCancel={() => { gesture.current = null; }}
    >
      {photos.map((photo, index) => (
        <div
          key={photo.id}
          id={`hero-slide-${photo.id}`}
          className={`hero-slide hero-slide-${photo.id}${active === index ? ' is-active' : ''}`}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${photos.length}: ${photo.title}`}
          aria-hidden={active !== index}
        >
          <img
            src={photo.src}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            fetchPriority={index === 0 ? 'high' : 'low'}
            decoding="async"
            draggable={false}
          />
        </div>
      ))}
      <div className="photo-shade" aria-hidden="true" />
      <span className="photo-overline">THE START OF SOMETHING GOOD.</span>
      <div className="hero-caption">A little romance.<br /><em>A lot of rhythm.</em></div>
      <div className="hero-photo-controls" role="group" aria-label="Photo controls">
        <button
          type="button"
          className="hero-photo-playback"
          aria-label={autoPlay ? 'Pause automatic photo rotation' : 'Play automatic photo rotation'}
          aria-controls="hero-slide-wedding hero-slide-zach"
          aria-describedby="hero-rotation-help"
          onClick={togglePlayback}
        >{autoPlay ? 'Pause' : 'Play'}</button>
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            ref={element => { buttons.current[index] = element; }}
            type="button"
            className="hero-photo-dot"
            aria-label={`Show photo ${index + 1} of ${photos.length}: ${photo.title}`}
            aria-controls={`hero-slide-${photo.id}`}
            aria-pressed={active === index}
            onClick={() => selectPhoto(index)}
            onKeyDown={event => selectWithKeyboard(event, index)}
          ><span aria-hidden="true" /></button>
        ))}
      </div>
      <span id="hero-rotation-help" className="hero-photo-status">
        Photos change every 4 seconds. Hovering or focusing the controls pauses rotation.
        Choosing a photo stops rotation until you press Play. Hovering still pauses it after Play.
      </span>
      <span className="hero-photo-status" role="status" aria-live={running ? 'off' : 'polite'} aria-atomic="true">
        Photo {active + 1} of {photos.length}: {photos[active].title}
      </span>
    </div>
  );
}
