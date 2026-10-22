'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import type { PublicTestimonial } from './testimonials-contract';

export default function TestimonialsSection() {
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/testimonials', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Unavailable');
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Unexpected response');
        setTestimonials(rows.filter((row): row is PublicTestimonial => !!row && typeof row === 'object' &&
          ['id', 'displayName', 'eventType', 'message', 'publishedAt'].every(key => typeof row[key] === 'string')));
        setStatus('ready');
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [retry]);

  return <section id="client-testimonials" className="client-testimonials wrap" aria-labelledby="testimonials-title">
    <div className="testimonials-heading">
      <div><div className="section-index">THE NIGHT, IN THEIR WORDS</div><h2 id="testimonials-title">Selected client<br/><em>testimonials.</em></h2></div>
      <div><p>A curated selection of experiences shared with Zach and published with permission—not a complete collection of customer reviews.</p><Link className="text-link" href="/testimonials">Share your experience <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
    </div>
    {status === 'loading' ? <p className="testimonial-state" role="status">Loading client testimonials…</p> : status === 'error' ? <div className="testimonial-state" role="status"><p>We couldn’t load testimonials right now.</p><button className="text-link" onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Try again</button></div> : testimonials.length ? <div className="testimonials-grid">{testimonials.map(testimonial => <figure className="testimonial-card" key={testimonial.id}>
      <MessageSquare size={23} aria-hidden="true" />
      <blockquote>{testimonial.message}</blockquote>
      <figcaption><span>{testimonial.displayName}</span><small>{testimonial.eventType}</small></figcaption>
    </figure>)}</div> : <div className="testimonial-state testimonial-empty"><MessageSquare size={26} aria-hidden="true" /><div><h3>The next story could be yours.</h3><p>No client testimonials have been published here yet. If you’ve celebrated with Zach, you’re welcome to share your experience.</p></div></div>}
  </section>;
}
