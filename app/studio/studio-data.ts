import { blankEventDetails, contactLine, inquiryServicePlan, type EventDetails } from '../event-details-contract';

export type Inquiry = { id: string; name: string; email: string; phone: string; date: string; venue: string; eventType: string; guests: string; hours: string; services: string; message: string; status: string; createdAt: string };
export type Entry = { id: string; title: string; date: string; start: string; end: string; venue: string; type: string; isPublic: boolean; facebook: string; notes: string; servicePlan: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; revision: string };
export const inquiryStatuses = ['New', 'Contacted', 'Quote sent', 'Booked', 'Declined', 'Canceled'];
export const blankEntry = { title: '', date: '', start: '', end: '', venue: '', type: 'Public appearance', isPublic: false, facebook: '', ...blankEventDetails };

// A NULL field belongs to a legacy event that has not been initialized yet.
// An empty string is an intentional owner edit and must never be re-prefilled.
export function entryDetails(event: Entry, inquiries: Inquiry[]): EventDetails {
  const inquiry = event.id.startsWith('booking-') ? inquiries.find(item => 'booking-' + item.id === event.id) : undefined;
  return {
    servicePlan: event.servicePlan ?? (inquiry ? inquiryServicePlan(inquiry.services) : ''),
    contactName: event.contactName ?? (inquiry ? contactLine(inquiry.name) : ''),
    contactEmail: event.contactEmail ?? inquiry?.email ?? '',
    contactPhone: event.contactPhone ?? (inquiry ? contactLine(inquiry.phone) : ''),
    notes: event.notes,
  };
}
export function contactPhoneHref(value: string) {
  const phone = value.trim();
  // Keep freeform extensions/instructions readable, but do not turn them into a
  // different dialed number by blindly concatenating all their digits.
  return /^\+?[\d\s().-]+$/.test(phone) && (phone.match(/\d/g)?.length ?? 0) >= 3 ? 'tel:' + phone.replace(/[^+\d]/g, '') : null;
}

// Schedule dates are local calendar days, never UTC instants. A UTC date slice
// drops tonight's bookings in US time zones and shifts dates near midnight.
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function calendarDate(value: string) { return new Date(value + 'T12:00:00'); }
export function formatDay(value: string, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }) {
  const parsed = calendarDate(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleDateString('en-US', options);
}
export function addDays(value: string, amount: number) {
  const date = calendarDate(value);
  date.setDate(date.getDate() + amount);
  return localDay(date);
}
export function shiftMonth(value: string, amount: number) {
  const date = calendarDate(value.slice(0, 7) + '-01');
  date.setMonth(date.getMonth() + amount);
  return localDay(date);
}
export function monthDays(value: string) {
  const first = value.slice(0, 7) + '-01';
  const offset = calendarDate(first).getDay();
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - offset));
}
export function dashboard(inquiries: Inquiry[], events: Entry[], today: string) {
  const upcoming = events.filter(event => event.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return {
    newInquiries: inquiries.filter(inquiry => inquiry.status === 'New').length,
    upcoming,
    nextEvent: upcoming.find(event => event.type !== 'Blocked date') ?? null,
    week: upcoming.filter(event => event.date < addDays(today, 7)),
    upcomingBookings: upcoming.filter(event => event.type === 'Private booking').length,
    publicAppearances: upcoming.filter(event => event.isPublic).length,
  };
}
export function servicesLabel(value: string) {
  try { const items: unknown = JSON.parse(value); return Array.isArray(items) ? items.filter(item => typeof item === 'string').join(' + ') : 'Services unavailable'; }
  catch { return 'Services unavailable'; }
}
export function parseStudioHash(hash: string): { view: string; event: string | null } {
  const [view, search] = hash.replace(/^#/, '').split('?');
  return { view: ['deck', 'bookings', 'calendar', 'snapshot', 'voices', 'settings', 'add-date'].includes(view) ? view : 'deck', event: new URLSearchParams(search).get('event') };
}
function escapeCalendar(value: string) { return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r/g, ''); }
export function calendarFile(event: Entry, now = new Date()) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DJ Zach B//Studio//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + escapeCalendar(event.id) + '@djzachb', 'DTSTAMP:' + now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), 'DTSTART;VALUE=DATE:' + event.date.replaceAll('-', ''), 'DTEND;VALUE=DATE:' + addDays(event.date, 1).replaceAll('-', ''), 'SUMMARY:' + escapeCalendar(event.title), 'LOCATION:' + escapeCalendar(event.venue), 'DESCRIPTION:' + escapeCalendar([event.start && ('Time: ' + event.start + (event.end ? ' – ' + event.end : '')), event.notes, event.facebook].filter(Boolean).join('\n')), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
