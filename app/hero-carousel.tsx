'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

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
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);

  function selectWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % photos.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + photos.length) % photos.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = photos.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }

  function startGesture(event: PointerEvent<HTMLDivElement>) {
    gesture.current = null;
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    if ((event.target as HTMLElement).closest('button')) return;
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
      <div className="hero-photo-controls" role="group" aria-label="Choose a photo">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            ref={element => { buttons.current[index] = element; }}
            type="button"
            className="hero-photo-dot"
            aria-label={`Show photo ${index + 1} of ${photos.length}: ${photo.title}`}
            aria-controls={`hero-slide-${photo.id}`}
            aria-pressed={active === index}
            onClick={() => setActive(index)}
            onKeyDown={event => selectWithKeyboard(event, index)}
          ><span aria-hidden="true" /></button>
        ))}
      </div>
      <span className="hero-photo-status" role="status" aria-live="polite" aria-atomic="true">
        Photo {active + 1} of {photos.length}: {photos[active].title}
      </span>
    </div>
  );
}
