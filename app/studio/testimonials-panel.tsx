'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './testimonials.css';

type Status = 'Pending' | 'Published' | 'Archived';
type Testimonial = {
  id: string;
  displayName: string;
  email: string;
  eventType: string;
  message: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  moderatedAt: string | null;
  moderatedBy: string | null;
  consentAt: string;
  consentVersion: string;
};
type Props = { active: boolean; onPendingCountChange: (count: number | null) => void; refreshKey?: number };
const statuses: Status[] = ['Pending', 'Published', 'Archived'];
const stamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};

async function responseData(response: Response): Promise<unknown> {
  // An expired Access session may redirect to an HTML sign-in page instead of JSON.
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Your Studio session may have expired. Reload this page and sign in again.');
  }
  return response.json();
}
function serverError(value: unknown, fallback: string) {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback;
}

export default function TestimonialsPanel({ active, onPendingCountChange, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<Testimonial[]>([]);
  const [filter, setFilter] = useState<Status>('Pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/manage/testimonials', { cache: 'no-store', signal: controller.signal });
      const data = await responseData(response);
      if (!response.ok) throw new Error(serverError(data, 'Could not load testimonials. Please try again.'));
      if (!Array.isArray(data)) throw new Error('Could not read the testimonials response. Please try again.');
      if (!mounted.current || sequence !== loadSequence.current || controller.signal.aborted) return false;
      const testimonials = data as Testimonial[];
      setRows(testimonials);
      setHasLoaded(true);
      onPendingCountChange(testimonials.filter(row => row.status === 'Pending').length);
      return true;
    } catch (cause) {
      if (!mounted.current || sequence !== loadSequence.current || controller.signal.aborted) return false;
      // Never leave stale private content/action controls visible after an authorization failure.
      setRows([]);
      setHasLoaded(false);
      onPendingCountChange(null);
      setError(cause instanceof Error ? cause.message : 'Could not load testimonials. Please try again.');
      return false;
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadController.current?.abort(); };
  }, []);
  useEffect(() => {
    const refresh = setTimeout(() => { if (!inFlight.current) void load(); }, 0);
    return () => clearTimeout(refresh);
  }, [active, load, refreshKey]);

  async function moderate(row: Testimonial, status: Status) {
    if (inFlight.current || loading) return;
    if (status === 'Published' && !window.confirm(`Publish ${row.displayName}’s original testimonial, display name, and event type on the website? Confirm this is a genuine client experience and contains no private information.`)) return;
    if (status === 'Archived' && !window.confirm(`Archive ${row.displayName}’s testimonial? It will not appear on the website. You can restore it to Pending later.`)) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      const response = await fetch('/api/manage/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status, expectedUpdatedAt: row.updatedAt }),
      });
      const data = await responseData(response);
      if (!mounted.current) return;
      if (response.status === 409) {
        const refreshed = await load();
        if (mounted.current && refreshed) setError('This testimonial changed in another session. The list is refreshed; review its current status before trying again.');
        return;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setRows([]); setHasLoaded(false); onPendingCountChange(null);
        }
        throw new Error(serverError(data, 'Could not save this change. Please try again.'));
      }
      saved = true;
      const refreshed = await load();
      if (mounted.current) setNotice(refreshed ? (status === 'Published' ? 'Published on the website.' : status === 'Archived' ? 'Archived and not visible on the website.' : 'Moved to Pending and not visible on the website.') : 'Your change was saved, but the list could not refresh. Reload it before making another change.');
    } catch (cause) {
      if (!mounted.current) return;
      // A network interruption could happen after the server saved a change: refresh before retrying.
      setRows([]); setHasLoaded(false); onPendingCountChange(null);
      setError(cause instanceof Error ? cause.message : 'Could not confirm this change. Reload the list before trying again.');
      if (!saved) setNotice('If the connection was interrupted, the change may already be saved. Reload the list to check before retrying.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const visible = rows.filter(row => row.status === filter);
  return <section className="studio-testimonials" aria-labelledby="testimonials-heading" aria-busy={loading || busy}>
    <div className="testimonial-panel-heading">
      <div><h2 id="testimonials-heading">The review queue</h2><p>Original experiences, shared with permission.</p></div>
      <a className="text-link" href="/testimonials" target="_blank" rel="noreferrer">Open submission form ↗</a>
    </div>
    <p className="notice">Only Published entries appear under “Selected client testimonials.” Check that each submission is a genuine client experience before publishing; use the private email to clarify anything uncertain. Email addresses and moderation details are never shown publicly. Do not publish private information included in the testimonial itself.</p>
    <div className="testimonial-toolbar">
      <div className="testimonial-filters" aria-label="Filter testimonials">{statuses.map(status => <button type="button" key={status} aria-pressed={filter === status} disabled={busy} onClick={() => { setFilter(status); setNotice(''); }}>{status} <span>{hasLoaded ? rows.filter(row => row.status === status).length : '—'}</span></button>)}</div>
      <button type="button" className="text-link" disabled={busy || loading} onClick={() => { setNotice(''); void load(); }}>Reload list ↻</button>
    </div>
    <p className="studio-error" role="alert">{error}</p>
    <p className="testimonial-notice" role="status">{notice}</p>
    {loading ? <p role="status">Loading testimonials…</p> : !hasLoaded ? <div className="empty-state"><p>Testimonials could not be loaded. No changes can be made until the list is available.</p><button type="button" className="text-link" disabled={busy} onClick={() => { setNotice(''); void load(); }}>Try again ↻</button><p><a href="/studio">Reload Studio / sign in again ↗</a></p></div> : !visible.length ? <div className="empty-state">{filter === 'Pending' ? 'No testimonials are waiting for review. New submissions will appear here before anything is published.' : filter === 'Published' ? 'Nothing is published yet. Approved client testimonials will appear on the website.' : 'No archived testimonials. Archived entries stay private and can be restored to Pending.'}</div> : visible.map(row => <article className="studio-record testimonial-record" key={row.id}>
      <div className="record-header"><div><small>{row.eventType}</small><h3>{row.displayName}</h3></div><span className={'testimonial-status status-' + row.status.toLowerCase()}>{row.status}</span></div>
      <blockquote className="testimonial-original">{row.message}</blockquote>
      <dl className="testimonial-private-details">
        <div><dt>Private email</dt><dd><a href={'mailto:' + encodeURIComponent(row.email)}>{row.email}</a></dd></div>
        <div><dt>Received</dt><dd><time dateTime={row.createdAt}>{stamp(row.createdAt)}</time></dd></div>
        <div><dt>Publication permission</dt><dd><time dateTime={row.consentAt}>{stamp(row.consentAt)}</time> · {row.consentVersion}</dd></div>
        {row.publishedAt && <div><dt>Published</dt><dd><time dateTime={row.publishedAt}>{stamp(row.publishedAt)}</time></dd></div>}
        {row.moderatedAt && <div><dt>Last moderated</dt><dd><time dateTime={row.moderatedAt}>{stamp(row.moderatedAt)}</time>{row.moderatedBy ? ' · ' + row.moderatedBy : ''}</dd></div>}
      </dl>
      <div className="record-actions testimonial-actions">
        {row.status === 'Pending' && <button type="button" disabled={busy || loading} onClick={() => void moderate(row, 'Published')}>Publish on website ↗</button>}
        {row.status === 'Published' && <button type="button" disabled={busy || loading} onClick={() => void moderate(row, 'Pending')}>Unpublish → Pending</button>}
        {row.status !== 'Archived' && <button type="button" disabled={busy || loading} onClick={() => void moderate(row, 'Archived')}>Archive</button>}
        {row.status === 'Archived' && <button type="button" disabled={busy || loading} onClick={() => void moderate(row, 'Pending')}>Restore to Pending</button>}
      </div>
      <p className="testimonial-editor-note">Original wording is preserved. For an edit or removal request, contact the client; unpublish first when permission is withdrawn.</p>
    </article>)}
  </section>;
}
