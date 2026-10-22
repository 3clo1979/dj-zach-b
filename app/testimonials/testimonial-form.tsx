'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, MessageSquare } from 'lucide-react';
import { TESTIMONIAL_CONSENT_VERSION, testimonialEventTypes } from '../testimonials-contract';

const initial = { displayName: '', email: '', eventType: 'Wedding', message: '', website: '', consent: false };

export default function TestimonialForm() {
  const [draft, setDraft] = useState(initial);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const submissionId = useRef('');
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) successHeading.current?.focus();
  }, [sent]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (draft.displayName.trim().length < 2 || draft.message.trim().length < 10) {
      setError('Please add your display name and at least 10 characters about your experience.');
      return;
    }
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      // Keep the same key if a response is lost and the visitor retries.
      if (!submissionId.current) submissionId.current = crypto.randomUUID();
      const response = await fetch('/api/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, submissionId: submissionId.current, consentVersion: TESTIMONIAL_CONSENT_VERSION }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(result.error || 'This submission needs to be checked before trying again. Please contact Zach if an earlier version may already have been saved.');
        }
        throw new Error(result.error || (response.status === 429
          ? 'Please wait a little before trying again. Your words are still here.'
          : 'We couldn’t save your testimonial. Your words are still here—please try again.'));
      }
      setSent(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'We couldn’t save your testimonial. Please try again.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <>
    <a className="skip" href="#share-experience">Skip to form</a>
    <header className="site-header testimonial-site-header">
      <a className="wordmark" href="/" aria-label="DJ Zach B home">
        <img className="header-logo" src="/images/dj-zach-b-logo.png" alt="" width="88" height="88" />
        <span>DJ ZACH B<small>MUSIC FOR YOUR MOMENTS</small></span>
      </a>
      <a className="text-link" href="/"><ArrowLeft size={15} aria-hidden="true" /> Back to the website</a>
    </header>
    <main id="share-experience" className="testimonial-page wrap">
      <div className="testimonial-intro">
        <div className="section-index">THE NIGHT, IN YOUR WORDS</div>
        <h1>How was<br/><em>your experience?</em></h1>
        <p>Been part of a celebration with Zach? Share an honest account of your experience—the moments that stayed with you, and anything you’d like him to know.</p>
        <div className="testimonial-process">
          <MessageSquare size={22} aria-hidden="true" />
          <div><h2>Your words. Your permission.</h2><p>Your submission goes privately to Zach first. Nothing appears on the website automatically.</p></div>
        </div>
        <p className="testimonial-private-option">Prefer to keep your feedback private? <a href="sms:4403961363">Text Zach</a> or <a href="tel:4403961363">call 440-396-1363</a> instead. You can also contact him to request that a published testimonial be removed.</p>
      </div>
      <div className="form-shell testimonial-form-shell">
        {sent ? <div className="thank-you testimonial-success">
          <span className="success-check"><Check size={30} aria-hidden="true" /></span>
          <div className="section-index">SAVED FOR ZACH TO REVIEW</div>
          <h2 ref={successHeading} tabIndex={-1}>Thank you for<br/><em>sharing your night.</em></h2>
          <p>Your testimonial is pending review. If selected, your words, display name, and event type may appear on the website. Your email stays private.</p>
          <a className="text-link" href="/#client-testimonials">Back to the website <ArrowUpRight size={18} aria-hidden="true" /></a>
        </div> : <form onSubmit={submit} aria-busy={sending}>
          <div className="form-heading"><span>SHARE YOUR EXPERIENCE</span><MessageSquare size={18} aria-hidden="true" /></div>
          <p className="testimonial-form-note">All fields below are required. Please share only your own experience, and leave out private details about other people.</p>
          <fieldset disabled={sending} className="testimonial-fields">
            <label htmlFor="testimonial-name">Public display name
              <input id="testimonial-name" name="displayName" required minLength={2} maxLength={80} autoComplete="name" value={draft.displayName} onChange={e => setDraft({ ...draft, displayName: e.target.value })} aria-describedby="testimonial-name-help" />
            </label>
            <p className="testimonial-field-help" id="testimonial-name-help">Choose how you’d like to be credited, such as your first name and last initial.</p>
            <label htmlFor="testimonial-email">Email <span className="testimonial-private-label">PRIVATE · NEVER DISPLAYED</span>
              <input id="testimonial-email" name="email" type="email" required maxLength={200} autoComplete="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} aria-describedby="testimonial-email-help" />
            </label>
            <p className="testimonial-field-help" id="testimonial-email-help">Used only to check or follow up on this submission, not added to a marketing list.</p>
            <label htmlFor="testimonial-event">Event type
              <select id="testimonial-event" name="eventType" required value={draft.eventType} onChange={e => setDraft({ ...draft, eventType: e.target.value })}>{testimonialEventTypes.map(type => <option key={type}>{type}</option>)}</select>
            </label>
            <label htmlFor="testimonial-message">Your experience
              <textarea id="testimonial-message" name="message" required minLength={10} maxLength={2000} rows={7} value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })} aria-describedby="testimonial-message-help" />
            </label>
            <p className="testimonial-field-help testimonial-character-count" id="testimonial-message-help">10–2,000 characters <span>{draft.message.length.toLocaleString()} / 2,000</span></p>
            <label className="honey" aria-hidden="true">Website<input name="website" value={draft.website} onChange={e => setDraft({ ...draft, website: e.target.value })} tabIndex={-1} autoComplete="off" /></label>
            <label className="consent testimonial-consent" htmlFor="testimonial-consent">
              <input id="testimonial-consent" name="consent" type="checkbox" required checked={draft.consent} onChange={e => setDraft({ ...draft, consent: e.target.checked })} />
              <span>I give DJ Zach B permission to publish my testimonial, display name, and event type on this website. I understand it will be reviewed before publication and may not be selected.</span>
            </label>
            <button className="button dark" type="submit" disabled={sending}>{sending ? 'SAVING YOUR WORDS…' : 'SEND TO ZACH FOR REVIEW'}<ArrowUpRight size={18} aria-hidden="true" /></button>
          </fieldset>
          {error && <p className="form-feedback" role="alert">{error}</p>}
          <p className="privacy-note">This form is for website testimonials. Your email is visible only in the private Studio. Submissions are reviewed for authenticity, spam, and personal information.</p>
        </form>}
      </div>
    </main>
    <div className="testimonial-page-bottom wrap"><span>DJ ZACH B · YOUR DAY. YOUR WAY.</span><a href="/">Back to the music ↑</a></div>
  </>;
}
