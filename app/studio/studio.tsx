'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ExternalLink, House, Inbox, LockKeyhole, MapPin, Menu, MessageSquare, Plus, RefreshCw, Settings, ShieldCheck, X } from 'lucide-react';
import TestimonialsPanel from './testimonials-panel';
import StudioPhoto from './studio-photo';
import EventDetailFields, { EventDetailSummary } from './event-detail-fields';
import { type EventDetails } from '../event-details-contract';
import { blankEntry, calendarFile, dashboard, entryDetails, formatDay, inquiryStatuses, localDay, monthDays, parseStudioHash, servicesLabel, shiftMonth, type Entry, type Inquiry } from './studio-data';
import './studio.css';

type EventEditor = { id: string; revision: string; original: EventDetails; draft: EventDetails };
function editorIsDirty(editor: EventEditor | null) { return !!editor && JSON.stringify(editor.original) !== JSON.stringify(editor.draft); }

const navigation = [
  { id: 'deck', label: 'On the Deck', short: 'Deck', icon: House },
  { id: 'bookings', label: 'Booking Desk', short: 'Bookings', icon: Inbox },
  { id: 'calendar', label: 'Calendar', short: 'Calendar', icon: CalendarDays },
  { id: 'voices', label: 'Client Voices', short: 'Voices', icon: MessageSquare },
];
const viewCopy: Record<string, { title: string; description: string }> = {
  deck: { title: 'On the Deck', description: 'A clear view of what needs you next.' },
  bookings: { title: 'Booking Desk', description: 'The next great night starts with a conversation.' },
  calendar: { title: 'Your calendar', description: 'Good nights ahead. Room for a little planning.' },
  voices: { title: 'Client Voices', description: 'Their words. Your good work. Shared with care.' },
  settings: { title: 'Make it yours', description: 'A few personal touches for your everyday desk.' },
  'add-date': { title: 'Save a date', description: 'Make space for the next good night.' },
};
async function responseData(response: Response) {
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Your Studio session may have expired. Reload Studio and sign in again.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Could not read the Studio response.');
  return data as { error?: string; inquiries?: Inquiry[]; events?: Entry[] };
}
function exportCalendar(event: Entry) {
  const url = URL.createObjectURL(new Blob([calendarFile(event)], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'dj-zach-b-' + event.date + '.ics'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DateTile({ value }: { value: string }) {
  return <time className="deck-date" dateTime={value}><span>{formatDay(value, { month: 'short' })}</span><b>{formatDay(value, { day: 'numeric' })}</b></time>;
}
function eventLink(event: Entry) { return '#calendar?event=' + encodeURIComponent(event.id); }

export default function Studio() {
  const [view, setView] = useState('deck');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pendingTestimonials, setPendingTestimonials] = useState<number | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [events, setEvents] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(blankEntry);
  const [privateEditor, setPrivateEditor] = useState<EventEditor | null>(null);
  const [filter, setFilter] = useState('All');
  const [today, setToday] = useState('');
  const [month, setMonth] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState('Upcoming');
  const [requestedEvent, setRequestedEvent] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const content = useRef<HTMLElement | null>(null);
  const formVersion = useRef(0);
  const editorVersion = useRef(0);
  const privateEditorHeading = useRef<HTMLLegendElement | null>(null);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    let sessionInvalid = false;
    try {
      const response = await fetch('/api/manage', { cache: 'no-store', signal: request.signal });
      sessionInvalid = response.status === 401 || response.status === 403 || response.redirected || !response.headers.get('content-type')?.includes('application/json');
      const data = await responseData(response);
      if (!response.ok) throw new Error(data.error || 'Could not load your Studio. Try again.');
      if (!Array.isArray(data.inquiries) || !Array.isArray(data.events)) throw new Error('Could not read your Studio data. Try again.');
      if (!mounted.current || request.signal.aborted || current !== sequence.current) return false;
      setInquiries(data.inquiries); setEvents(data.events); setHasLoaded(true); return { inquiries: data.inquiries, events: data.events };
    } catch (cause) {
      if (!mounted.current || request.signal.aborted || current !== sequence.current) return false;
      setInquiries([]); setEvents([]); setHasLoaded(false);
      if (sessionInvalid) { setPrivateEditor(null); setDraft(blankEntry); editorVersion.current++; formVersion.current++; }
      setError(cause instanceof Error ? cause.message : 'Could not load your Studio. Try again.'); return false;
    } finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const syncNavigation = () => {
      const next = parseStudioHash(window.location.hash);
      setView(next.view); setRequestedEvent(next.event); setMobileMenu(false);
    };
    const initial = setTimeout(() => {
      const currentDay = localDay(); setToday(currentDay); setMonth(currentDay.slice(0, 7) + '-01');
      syncNavigation(); void load();
    }, 0);
    window.addEventListener('hashchange', syncNavigation);
    const refreshDay = () => setToday(localDay());
    window.addEventListener('focus', refreshDay);
    const timer = setInterval(refreshDay, 60_000);
    return () => { clearTimeout(initial); mounted.current = false; controller.current?.abort(); window.removeEventListener('hashchange', syncNavigation); window.removeEventListener('focus', refreshDay); clearInterval(timer); };
  }, [load]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }); }, [view]);
  useEffect(() => {
    if (!requestedEvent) return;
    const event = events.find(item => item.id === requestedEvent);
    const update = setTimeout(() => { if (event) { setMonth(event.date.slice(0, 7) + '-01'); setSelectedDay(event.date); } }, 0);
    return () => clearTimeout(update);
  }, [requestedEvent, events]);

  // Hash navigation keeps the private draft in Studio state. Leaving/reloading
  // the page needs an explicit browser warning, not silent draft loss.
  const dirtyEditor = editorIsDirty(privateEditor);
  useEffect(() => {
    if (!dirtyEditor) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyEditor]);

  useEffect(() => { if (view === 'calendar' && hasLoaded) privateEditorHeading.current?.focus({ preventScroll: true }); }, [privateEditor?.id, view, hasLoaded]);

  async function act(body: unknown) {
    if (inFlight.current || !hasLoaded || loading) return false;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    let saved = false;
    let confirmedResponse = false;
    let sessionInvalid = false;
    try {
      const response = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      sessionInvalid = response.status === 401 || response.status === 403 || response.redirected || !response.headers.get('content-type')?.includes('application/json');
      const data = await responseData(response);
      if (!mounted.current) return false;
      confirmedResponse = response.ok || (response.status >= 400 && response.status < 500);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setInquiries([]); setEvents([]); setHasLoaded(false); }
        throw new Error(data.error || 'Could not save this change.');
      }
      saved = true;
      const refreshed = await load();
      if (mounted.current) setNotice(refreshed ? 'Saved. Your desk is up to date.' : 'Your change was saved, but the list could not refresh. Reload it before making another change.');
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      if (sessionInvalid) { setPrivateEditor(null); setDraft(blankEntry); editorVersion.current++; formVersion.current++; }
      // An interrupted response may follow a successful write. Never retry it automatically.
      if (!confirmedResponse) {
        setInquiries([]); setEvents([]); setHasLoaded(false);
        setNotice('This change may already be saved. Reload the list to check before trying again.');
      }
      setError(cause instanceof Error ? cause.message : 'Could not confirm this change. Reload the list before retrying.');
      return saved;
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function refresh() { if (inFlight.current) return; setNotice(''); setRefreshKey(key => key + 1); void load(); }
  function selectCalendarDay(day: string) {
    setSelectedDay(day);
    const event = events.find(item => item.date === day);
    window.location.hash = event ? eventLink(event) : 'calendar';
  }
  function clearCalendarSelection() { setSelectedDay(null); window.location.hash = 'calendar'; }
  function addDate(day?: string) { formVersion.current++; setDraft({ ...blankEntry, date: day || '' }); }
  function openEventEditor(event: Entry) {
    if (inFlight.current || loading || !hasLoaded || privateEditor?.id === event.id) return;
    if (editorIsDirty(privateEditor) && !window.confirm('Discard the unsaved details for the other event?')) return;
    editorVersion.current++;
    const details = entryDetails(event, inquiries);
    setPrivateEditor({ id: event.id, revision: event.revision, original: details, draft: { ...details } });
  }
  function closeEventEditor() {
    if (inFlight.current || loading) return;
    if (editorIsDirty(privateEditor) && !window.confirm('Discard these unsaved event details?')) return;
    editorVersion.current++; setPrivateEditor(null);
  }
  async function reloadEventEditor() {
    if (inFlight.current || loading || !privateEditor) return;
    if (editorIsDirty(privateEditor) && !window.confirm('Replace your unsaved changes with the latest saved details?')) return;
    const id = privateEditor.id, version = ++editorVersion.current;
    const refreshed = await load();
    if (!refreshed || !mounted.current || version !== editorVersion.current) return;
    const event = refreshed.events.find(item => item.id === id);
    if (!event) { setError('This event is no longer saved. Your unsaved details have not been saved.'); return; }
    const details = entryDetails(event, refreshed.inquiries);
    setPrivateEditor({ id, revision: event.revision, original: details, draft: { ...details } });
  }
  async function saveEventDetails() {
    if (!privateEditor || inFlight.current || loading || !hasLoaded) return;
    const version = editorVersion.current;
    if (await act({ action: 'update-event-details', id: privateEditor.id, revision: privateEditor.revision, ...privateEditor.draft }) && version === editorVersion.current) {
      editorVersion.current++; setPrivateEditor(null);
    }
  }
  async function changeInquiryStatus(inquiry: Inquiry, status: string) {
    if (inFlight.current || loading || !hasLoaded) return;
    const event = events.find(item => item.id === 'booking-' + inquiry.id);
    if (status !== 'Booked' && event && !window.confirm('Changing this booking status removes its calendar entry and all saved private event details. Continue?')) return;
    if (await act({ action: 'status', id: inquiry.id, status, ...(status !== 'Booked' && event ? { bookingRevision: event.revision } : {}) }) && status !== 'Booked' && privateEditor?.id === event?.id) {
      editorVersion.current++; setPrivateEditor(null);
    }
  }
  async function removeEvent(event: Entry) {
    if (inFlight.current || loading || !hasLoaded) return;
    if (!window.confirm('Remove this schedule entry and all of its private event details? This releases the date in Studio.')) return;
    if (await act({ action: 'delete-event', id: event.id, revision: event.revision }) && privateEditor?.id === event.id) {
      editorVersion.current++; setPrivateEditor(null);
    }
  }
  const data = dashboard(inquiries, events, today || localDay());
  const known = hasLoaded && !loading;
  const count = (value: number) => known ? value : '—';
  const selectedEvents = selectedDay ? events.filter(event => event.date === selectedDay) : events.filter(event => scheduleFilter === 'All' || (scheduleFilter === 'Upcoming' ? event.date >= today : event.date < today));
  const visibleInquiries = inquiries.filter(inquiry => filter === 'All' || inquiry.status === filter);
  const currentNav = view === 'add-date' ? 'calendar' : view;
  const copy = viewCopy[view];
  const navLinks = (compact = false) => navigation.map(item => <a key={item.id} href={'#' + item.id} aria-current={currentNav === item.id ? 'page' : undefined} onClick={() => setMobileMenu(false)}><item.icon size={21} aria-hidden="true"/><span>{compact ? item.short : item.label}</span>{!compact && item.id === 'bookings' && known && data.newInquiries > 0 && <b className="studio-nav-count" aria-label={data.newInquiries + ' new inquiries'}>{data.newInquiries}</b>}{!compact && item.id === 'voices' && pendingTestimonials !== null && pendingTestimonials > 0 && <b className="studio-nav-count" aria-label={pendingTestimonials + ' pending testimonials'}>{pendingTestimonials}</b>}</a>);

  return <div className="studio-shell">
    <a className="studio-skip" href="#studio-content" onClick={event => { event.preventDefault(); content.current?.focus(); content.current?.scrollIntoView({ block: 'start' }); }}>Skip to desk</a>
    <aside className="studio-sidebar">
      <a className="studio-brand" href="#deck" aria-label="DJ Zach B Studio home"><img src="/images/dj-zach-b-logo.png" alt="DJ Zach B" width="136" height="136"/><span>STUDIO</span></a>
      <nav aria-label="Studio">{navLinks()}</nav>
      <div className="studio-sidebar-bottom"><a href="#settings" aria-current={view === 'settings' ? 'page' : undefined}><Settings size={20} aria-hidden="true"/>Settings</a><a href="/" target="_blank" rel="noreferrer"><ExternalLink size={18} aria-hidden="true"/>View website</a><span><LockKeyhole size={12} aria-hidden="true"/>Your private workspace</span></div>
    </aside>
    <div className="studio-main">
      <div className="studio-mobile-top"><a href="#deck" className="studio-mobile-brand"><img src="/images/dj-zach-b-logo.png" alt="DJ Zach B" width="54" height="54"/><span>STUDIO</span></a><button className="studio-icon-button" type="button" aria-label={mobileMenu ? 'Close Studio menu' : 'Open Studio menu'} aria-expanded={mobileMenu} aria-controls="studio-mobile-menu" onClick={() => setMobileMenu(open => !open)}>{mobileMenu ? <X aria-hidden="true"/> : <Menu aria-hidden="true"/>}</button></div>
      {mobileMenu && <nav className="studio-mobile-menu" id="studio-mobile-menu" aria-label="More Studio links"><a href="#settings" onClick={() => setMobileMenu(false)}><Settings size={18} aria-hidden="true"/>Settings & photo</a><a href="/" target="_blank" rel="noreferrer"><ExternalLink size={18} aria-hidden="true"/>View website</a></nav>}
      <header className="studio-desk-header"><div><p className="studio-eyebrow">{view === 'deck' ? 'Welcome back, Zach' : 'DJ Zach B · Private Studio'}</p><h1 ref={heading} tabIndex={-1}>{copy.title}</h1><p className="studio-intro">{copy.description}</p></div><div className="studio-header-photo"><StudioPhoto/></div></header>
      <main ref={content} id="studio-content" className="studio-content" tabIndex={-1}>
        <div className="studio-context-bar"><span><ShieldCheck size={14} aria-hidden="true"/>{today ? formatDay(today, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Your private workspace'}</span><button type="button" onClick={refresh} disabled={busy || loading}><RefreshCw size={14} aria-hidden="true"/>{loading ? 'Refreshing…' : 'Refresh desk'}</button></div>
        {error && <div className="studio-alert" role="alert"><p>{error}</p><button type="button" disabled={busy || loading} onClick={refresh}>Try again</button><a href="/studio">Reload Studio / sign in again</a></div>}
        {notice && <p className="studio-status-message" role="status">{notice}</p>}
        {view === 'deck' && <section className="deck-dashboard" aria-label="Your Studio overview" aria-busy={loading}>
          <article className="deck-review deck-card"><div><p className="studio-eyebrow">{pendingTestimonials === null ? 'Client Voices' : pendingTestimonials > 0 ? 'Ready for your review' : 'A little breathing room'}</p><h2>{pendingTestimonials === null ? 'Your client stories' : pendingTestimonials > 0 ? `${pendingTestimonials} testimonial${pendingTestimonials === 1 ? '' : 's'} waiting` : 'You’re all caught up.'}</h2><p>{pendingTestimonials === null ? 'Open Client Voices to check the review queue.' : pendingTestimonials > 0 ? 'Check each story before it goes live.' : 'No testimonials are waiting for review.'}</p></div><a className="studio-button gold" href="#voices">{pendingTestimonials !== null && pendingTestimonials > 0 ? `Review ${pendingTestimonials} testimonial${pendingTestimonials === 1 ? '' : 's'}` : 'Open Client Voices'}<ArrowRight size={20} aria-hidden="true"/></a></article>
          <div className="deck-two-up"><article className="deck-card deck-next"><p className="studio-eyebrow">Next event</p>{!known ? <div className="deck-card-placeholder"><CalendarDays size={26} aria-hidden="true"/><h2>{loading ? 'Finding your next date…' : 'Your schedule is unavailable'}</h2><p>{loading ? 'Getting your saved events.' : 'Refresh your desk to check the calendar.'}</p></div> : data.nextEvent ? <><div className="deck-next-detail"><DateTile value={data.nextEvent.date}/><div><h2>{data.nextEvent.title}</h2><p>{data.nextEvent.type}{data.nextEvent.start ? ' · ' + data.nextEvent.start : ''}</p>{data.nextEvent.venue && <p className="deck-venue"><MapPin size={14} aria-hidden="true"/>{data.nextEvent.venue}</p>}</div></div><a className="studio-button outline" href={eventLink(data.nextEvent)}>Open event<ArrowRight size={17} aria-hidden="true"/></a></> : <div className="deck-card-placeholder"><CalendarDays size={27} aria-hidden="true"/><h2>Your next good night awaits.</h2><p>No upcoming events saved. Add a date when it’s confirmed.</p><a className="studio-button outline" href="#calendar">Open calendar<ArrowRight size={17} aria-hidden="true"/></a></div>}</article>
          <article className="deck-card deck-inquiries"><p className="studio-eyebrow">Booking Desk</p><h2>{count(data.newInquiries)} new {data.newInquiries === 1 && known ? 'inquiry' : 'inquiries'}</h2><p>{known && data.newInquiries === 0 ? 'New requests from the website will land here.' : 'Start the next great night.'}</p><a className="studio-button outline" href="#bookings" onClick={() => setFilter(known && data.newInquiries > 0 ? 'New' : 'All')}>Review inquiries<ArrowRight size={17} aria-hidden="true"/></a></article></div>
          <section className="deck-card deck-week" aria-labelledby="week-heading"><div className="deck-section-heading"><div><h2 id="week-heading">Your next seven days</h2><p>Saved events and blocked dates, at a glance.</p></div><a href="#calendar">Open calendar<ArrowRight size={17} aria-hidden="true"/></a></div>{!known ? <p className="deck-empty">{loading ? 'Loading your week…' : 'Your week will appear when the desk can refresh.'}</p> : data.week.length ? <ul>{data.week.map(event => <li key={event.id}><time dateTime={event.date}>{formatDay(event.date, { month: 'short', day: 'numeric' })}</time><a href={eventLink(event)}>{event.title}<small>{event.venue || event.type}</small></a><span className="studio-pill">{event.type === 'Blocked date' ? 'Blocked' : event.isPublic ? 'Public' : 'Private'}</span><ArrowRight size={15} aria-hidden="true"/></li>)}</ul> : <p className="deck-empty">A clear week on your Studio calendar. No saved events or blocked dates in the next seven days.</p>}</section>
          <div className="deck-metrics"><a href="#calendar"><b>{count(data.upcomingBookings)}</b><span>Upcoming bookings</span><ArrowRight size={16} aria-hidden="true"/></a><a href="#calendar"><b>{count(data.publicAppearances)}</b><span>Public appearances</span><ArrowRight size={16} aria-hidden="true"/></a></div>
        </section>}
        {view === 'bookings' && <section aria-label="Booking inquiries" aria-busy={loading || busy}><div className="studio-section-toolbar"><label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option>All</option>{inquiryStatuses.map(status => <option key={status}>{status}</option>)}</select></label><p>{known ? `${visibleInquiries.length} ${visibleInquiries.length === 1 ? 'inquiry' : 'inquiries'}` : 'Checking inquiries…'}</p></div>{loading ? <p className="studio-empty" role="status">Loading your Booking Desk…</p> : !hasLoaded ? <p className="studio-empty">Inquiries are unavailable. Reload your desk before making changes.</p> : !visibleInquiries.length ? <div className="studio-empty"><Inbox size={30} aria-hidden="true"/><h2>{filter === 'All' ? 'A fresh start.' : `No ${filter.toLowerCase()} inquiries.`}</h2><p>{filter === 'All' ? 'Requests from the website will appear here. Nothing to chase just yet.' : 'Choose another status to see the rest of your Booking Desk.'}</p></div> : visibleInquiries.map(inquiry => <article className="studio-record" key={inquiry.id}><div className="record-header"><div><small>{inquiry.eventType} · {formatDay(inquiry.date)}</small><h3>{inquiry.name}</h3><p>{inquiry.venue}</p></div><span className={'studio-pill ' + (inquiry.status === 'New' ? 'gold' : '')}>{inquiry.status}</span></div><div className="record-detail"><p>{servicesLabel(inquiry.services)}</p><p>{[inquiry.guests && inquiry.guests + ' guests', inquiry.hours].filter(Boolean).join(' · ')}</p><p>{inquiry.message || 'No additional notes.'}</p><small>Received {new Date(inquiry.createdAt).toLocaleString()}</small></div><div className="record-actions"><a href={'mailto:' + encodeURIComponent(inquiry.email)}>Email {inquiry.email}</a><a href={'tel:' + inquiry.phone}>Call {inquiry.phone}</a><label>Update status<select aria-label={'Status for ' + inquiry.name} disabled={busy || loading} value={inquiry.status} onChange={event => void changeInquiryStatus(inquiry, event.target.value)}>{inquiryStatuses.map(status => <option key={status}>{status}</option>)}</select></label></div></article>)}</section>}
        {view === 'calendar' && <section aria-label="Studio calendar" aria-busy={loading || busy}>
          <div className="studio-section-toolbar"><p>Saved dates only · check your phone before confirming.</p><a className="studio-button gold" href="#add-date" onClick={() => addDate(selectedDay || undefined)}><Plus size={17} aria-hidden="true"/>Add a date</a></div>
          {month && <div className="studio-calendar deck-card"><div className="calendar-heading"><h2>{formatDay(month, { month: 'long', year: 'numeric' })}</h2><div><button className="studio-icon-button" type="button" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); clearCalendarSelection(); }}><ChevronLeft size={20} aria-hidden="true"/></button><button type="button" className="calendar-today" onClick={() => { setMonth(today.slice(0, 7) + '-01'); selectCalendarDay(today); }}>Today</button><button className="studio-icon-button" type="button" aria-label="Next month" onClick={() => { setMonth(shiftMonth(month, 1)); clearCalendarSelection(); }}><ChevronRight size={20} aria-hidden="true"/></button></div></div><div className="calendar-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid" aria-label="Choose a date">{monthDays(month).map(day => { const event = known ? events.find(entry => entry.date === day) : undefined; return <button type="button" key={day} className={(day.slice(0, 7) !== month.slice(0, 7) ? 'outside ' : '') + (event ? 'has-event ' : '') + (day === today ? 'is-today' : '')} aria-pressed={selectedDay === day} aria-label={formatDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (event ? ', ' + event.title + ', ' + event.type : known ? ', no saved entry' : ', schedule not loaded')} onClick={() => selectCalendarDay(day)}><span>{Number(day.slice(-2))}</span>{event && <><i className={event.type === 'Blocked date' ? 'blocked' : event.isPublic ? 'public' : 'private'} aria-hidden="true"/><small>{event.title}</small></>}</button>; })}</div><p className="calendar-legend"><span><i className="private"/>Private</span><span><i className="public"/>Public</span><span><i className="blocked"/>Blocked</span></p></div>}
          {known && requestedEvent && !events.some(event => event.id === requestedEvent) && <p className="studio-alert" role="status">This event is no longer available in your saved calendar.</p>}
          {known && privateEditor && !events.some(event => event.id === privateEditor.id) && <article className="studio-record"><h3>The event you were editing is no longer saved.</h3><p>Your unsaved details were not saved. You can copy them below before discarding this draft.</p><EventDetailSummary value={privateEditor.draft}/><div className="record-actions"><button type="button" onClick={closeEventEditor}>Discard unsaved details</button></div></article>}
          <div className="studio-section-toolbar calendar-agenda-title"><h2>{selectedDay ? formatDay(selectedDay) : 'Your schedule'}</h2>{selectedDay ? <button className="studio-text-button" type="button" onClick={clearCalendarSelection}>Show full schedule</button> : <label className="studio-filter-label">Show<select value={scheduleFilter} onChange={event => setScheduleFilter(event.target.value)}>{['Upcoming', 'Past', 'All'].map(value => <option key={value}>{value}</option>)}</select></label>}</div>
          {loading ? <p className="studio-empty" role="status">Loading your calendar…</p> : !hasLoaded ? <p className="studio-empty">Your saved dates are unavailable. Refresh your desk to check them.</p> : !selectedEvents.length ? <div className="studio-empty"><CalendarDays size={28} aria-hidden="true"/><h2>{selectedDay ? 'No saved entry for this date.' : 'Room for what’s next.'}</h2><p>{selectedDay ? 'This is not an availability guarantee. Check your phone calendar before confirming.' : `No ${scheduleFilter === 'All' ? '' : scheduleFilter.toLowerCase() + ' '}dates saved here.`}</p><a className="studio-button outline" href="#add-date" onClick={() => addDate(selectedDay || undefined)}><CalendarPlus size={17} aria-hidden="true"/>Add a date</a></div> : selectedEvents.map(event => <article className="studio-record" key={event.id}><div className="record-header"><div><small>{formatDay(event.date)} · {event.type}</small><h3>{event.title}</h3><p>{[event.venue, event.start && event.start + (event.end ? '–' + event.end : '')].filter(Boolean).join(' · ')}</p></div><span className="studio-pill">{event.isPublic ? 'Visible on website' : 'Private'}</span></div><EventDetailSummary value={entryDetails(event, inquiries)}/>
          {privateEditor?.id === event.id && <form className="studio-form event-private-editor" aria-label={'Edit private details for ' + event.title} aria-busy={busy} onSubmit={async event => { event.preventDefault(); await saveEventDetails(); }}>
            <fieldset disabled={busy || loading || !hasLoaded}><legend ref={privateEditorHeading} tabIndex={-1}>Edit private details</legend>
              {privateEditor.revision !== event.revision && <p role="status" className="event-edit-warning">This event has newer saved details. Reload saved details before making another change.</p>}
              <EventDetailFields value={privateEditor.draft} onChange={value => { if (inFlight.current || loading) return; editorVersion.current++; setPrivateEditor({ ...privateEditor, draft: value }); }}/>
              <div className="studio-form-actions"><button type="submit" className="studio-button gold" disabled={privateEditor.revision !== event.revision}><Check size={18} aria-hidden="true"/>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" className="studio-button outline" disabled={busy || loading} onClick={closeEventEditor}>Cancel edits</button><button type="button" className="studio-text-button" disabled={busy || loading} onClick={() => void reloadEventEditor()}>Reload saved details</button></div>
              <p className="studio-fine-print">{dirtyEditor ? 'Unsaved changes. Your draft stays here when you switch Studio tabs.' : 'Only the private details change. The date, visibility, and inquiry stay unchanged.'}</p>
            </fieldset>
          </form>}
          <div className="record-actions">{privateEditor?.id !== event.id && <button type="button" disabled={busy || loading} onClick={() => openEventEditor(event)}>Edit private details</button>}<button type="button" onClick={() => exportCalendar(event)}><ArrowDownToLine size={16} aria-hidden="true"/>Download calendar entry</button>{event.facebook && <a href={event.facebook} target="_blank" rel="noreferrer">Facebook event<ExternalLink size={15} aria-hidden="true"/></a>}{!event.id.startsWith('booking-') ? <button type="button" disabled={busy || loading} onClick={() => void removeEvent(event)}>Remove entry</button> : <a href="#bookings" onClick={() => setFilter('Booked')}>Manage booking<ArrowRight size={15} aria-hidden="true"/></a>}</div></article>)}
        </section>}
        {view === 'add-date' && hasLoaded && <form className="studio-form" aria-busy={busy} onSubmit={async event => { event.preventDefault(); const version = formVersion.current; if (await act({ action: 'event', ...draft }) && version === formVersion.current) { setDraft(blankEntry); setSelectedDay(null); if (parseStudioHash(window.location.hash).view === 'add-date') window.location.hash = 'calendar'; } }}><fieldset disabled={busy || loading || !hasLoaded}><legend>Event details</legend><label>Entry type<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value, isPublic: false, facebook: '' })}><option>Public appearance</option><option>Private booking</option><option>Blocked date</option></select></label><label>Title<input required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label><label>Date<input type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })}/></label><div className="form-grid"><label>Start time<input type="time" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })}/></label><label>End time<input type="time" value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })}/></label></div><label>Venue & city<input maxLength={300} value={draft.venue} onChange={event => setDraft({ ...draft, venue: event.target.value })}/></label>{draft.type === 'Public appearance' && <><label>Facebook event URL (optional)<input type="url" maxLength={1000} placeholder="https://www.facebook.com/events/…" value={draft.facebook} onChange={event => setDraft({ ...draft, facebook: event.target.value })}/></label><label className="consent"><input type="checkbox" checked={draft.isPublic} onChange={event => setDraft({ ...draft, isPublic: event.target.checked })}/>Show this appearance on the public website</label></>}<EventDetailFields value={draft} onChange={value => setDraft({ ...draft, ...value })}/><div className="studio-form-actions"><button className="studio-button gold" type="submit"><Check size={18} aria-hidden="true"/>{busy ? 'Saving…' : 'Save date'}</button><button type="button" className="studio-button outline" disabled={busy} onClick={() => { if (inFlight.current) return; formVersion.current++; setDraft(blankEntry); window.location.hash = 'calendar'; }}>Cancel</button></div></fieldset><p className="studio-fine-print">One schedule entry per date. Review the existing entry if a date is already occupied.</p></form>}
        <div hidden={view !== 'voices'}><TestimonialsPanel active={view === 'voices'} onPendingCountChange={setPendingTestimonials} refreshKey={refreshKey}/></div>
        {view === 'add-date' && !hasLoaded && <p className="studio-empty">Reload your desk and sign in if needed before adding a date.</p>}
        {view === 'settings' && <section className="studio-settings" aria-label="Studio settings"><article className="deck-card"><p className="studio-eyebrow">Your corner of the desk</p><StudioPhoto editable/></article><article className="deck-card"><p className="studio-eyebrow">Connected & clear</p><h2>What your desk does today</h2><ul className="studio-connection-list"><li><Check size={18} aria-hidden="true"/><div><b>Website inquiries</b><p>Saved to your Booking Desk. Email notifications are not connected.</p></div></li><li><Check size={18} aria-hidden="true"/><div><b>Your Studio calendar</b><p>Booking an inquiry creates a private calendar entry. Changing it out of Booked releases the date.</p></div></li><li><CalendarDays size={18} aria-hidden="true"/><div><b>Calendar downloads, not live sync</b><p>Downloads add an all-day entry with event times in the notes. Yahoo / phone sync is not connected; check existing commitments before confirming.</p></div></li><li><LockKeyhole size={18} aria-hidden="true"/><div><b>Private by default</b><p>Only explicitly public appearances and Published testimonials appear on the website.</p></div></li></ul></article></section>}
        <div className="studio-footer-note"><LockKeyhole size={13} aria-hidden="true"/><span>Private Studio · Your inquiries, dates, and client stories.</span></div>
      </main>
    </div>
    <nav className="studio-bottom-nav" aria-label="Studio mobile">{navLinks(true)}</nav>
  </div>;
}
