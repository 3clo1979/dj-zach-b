import { ArrowRight, BarChart3, CalendarDays, Clock3, LockKeyhole } from 'lucide-react';
import { businessSnapshot, BUSINESS_TIME_ZONE, type BusinessSnapshot as Snapshot } from './business-snapshot-data';
import { type Entry, type Inquiry } from './studio-data';

type Props = {
  inquiries: Inquiry[];
  events: Entry[];
  asOf: string | null;
  loading: boolean;
  hasLoaded: boolean;
  onReviewNew: () => void;
};
const shortDate = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(day + 'T12:00:00Z'));
const rate = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
function comparison(current: number, prior: number) {
  const difference = current - prior;
  return difference === 0 ? `Same as prior 30 days (${prior})` : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'} than prior 30 days (${prior})`;
}
function InquiryTrend({ trend }: { trend: Snapshot['trend'] }) {
  const max = Math.max(1, ...trend.map(month => month.inquiries));
  const label = (month: string, short = false) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' }).format(new Date(month + '-01T12:00:00Z'));
  return <figure className="snapshot-trend">
    <svg viewBox="0 0 600 210" role="img" aria-label={'Website inquiries by received month. ' + trend.map(month => `${label(month.month)}: ${month.inquiries}${month.partial ? ' (month to date)' : ''}`).join('; ')}>
      <line x1="12" y1="162" x2="588" y2="162" className="snapshot-chart-baseline"/>
      {trend.map((month, index) => {
        const height = month.inquiries / max * 120;
        const x = 24 + index * 96;
        return <g key={month.month}>
          <rect x={x} y={162 - height} width="72" height={height} rx="4" className={month.partial ? 'snapshot-chart-current' : 'snapshot-chart-bar'}/>
          <text x={x + 36} y={150 - height} textAnchor="middle" className="snapshot-chart-count">{month.inquiries}</text>
          <text x={x + 36} y="191" textAnchor="middle" className="snapshot-chart-label">{label(month.month, true)}{month.partial ? '*' : ''}</text>
        </g>;
      })}
    </svg>
    <figcaption>* Current month through the last refresh; not a full-month comparison. Earlier months show saved inquiries, not proof that tracking was active all month.</figcaption>
  </figure>;
}

export default function BusinessSnapshot({ inquiries, events, asOf, loading, hasLoaded, onReviewNew }: Props) {
  if (loading) return <section className="snapshot-empty deck-card" aria-busy="true" aria-label="Business Snapshot"><BarChart3 size={28} aria-hidden="true"/><h2>Gathering your snapshot…</h2><p role="status">Loading saved inquiries and calendar entries. No totals are shown until the refresh finishes.</p></section>;
  if (!hasLoaded || !asOf || !Number.isFinite(Date.parse(asOf))) return <section className="snapshot-empty deck-card" aria-label="Business Snapshot"><LockKeyhole size={28} aria-hidden="true"/><h2>Your snapshot is unavailable.</h2><p>Refresh your desk to load your private data. If your session expired, reload Studio and sign in again.</p></section>;
  const snapshot = businessSnapshot(inquiries, events, new Date(asOf));
  const { windows, current, prior, followUps, upcomingBookings } = snapshot;
  const refreshLabel = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(asOf));
  const dateIssues = snapshot.invalidCreatedAtCount + snapshot.futureCreatedAtCount;
  return <section className="business-snapshot" aria-label="Business Snapshot">
    <div className="snapshot-period"><div><p className="studio-eyebrow">Last 30 complete days</p><h2>{shortDate(windows.currentStart)} – {shortDate(windows.currentEnd)}</h2><p>Compared with {shortDate(windows.priorStart)} – {shortDate(windows.priorEnd)} · America/New_York</p><p className="snapshot-as-of">As of {refreshLabel} · Refresh desk to update</p></div><span className="studio-pill"><LockKeyhole size={12} aria-hidden="true"/>Private · known TEST records excluded</span></div>
    <div className="snapshot-cards">
      <article className="deck-card snapshot-metric"><h3>Website inquiries</h3><strong>{current.inquiries}</strong><p className="snapshot-comparison">{comparison(current.inquiries, prior.inquiries)}</p><p>Requests received in this window, not unique people. Today is not included.</p></article>
      <article className="deck-card snapshot-metric"><h3>Booked from these inquiries</h3><strong>{current.booked}</strong><p className="snapshot-comparison">{prior.booked} currently Booked from the prior window</p><p>Of the {current.inquiries} inquiries above, how many are marked Booked now. Not bookings made during the window.</p></article>
      <article className="deck-card snapshot-metric"><h3>Inquiry → booking</h3><strong>{rate(current.conversionRate)}</strong><p className="snapshot-comparison">{prior.conversionRate === null ? 'Prior window: no inquiries to compare' : `Prior inquiry group: ${rate(prior.conversionRate)}`}</p><p>{current.inquiries ? `${current.booked} currently Booked ÷ ${current.inquiries} received.` : 'No inquiries in this window, so there is no rate yet.'} This is not visitor conversion.</p></article>
      <article className="deck-card snapshot-metric snapshot-followup"><h3>Awaiting first follow-up</h3><strong>{followUps.newInquiries}</strong><p className="snapshot-comparison"><Clock3 size={15} aria-hidden="true"/>{followUps.agedSevenDays} received 7+ calendar days ago</p><p>All saved inquiries still marked New, including today. This is a current queue, not a 30-day total.</p><a href="#bookings" onClick={onReviewNew}>Review New inquiries<ArrowRight size={16} aria-hidden="true"/></a></article>
    </div>
    <p className="snapshot-cohort-note">The inquiry groups are based on when the request arrived; their Booked status is checked now. Recent inquiries have had less time to book. Canceled or declined inquiries are not counted as Booked.</p>
    <div className="snapshot-detail-grid">
      <article className="deck-card"><p className="studio-eyebrow">The longer view</p><h2>Inquiries, month by month</h2><p className="snapshot-section-intro">Six calendar months of saved website requests.</p><InquiryTrend trend={snapshot.trend}/></article>
      <article className="deck-card snapshot-schedule"><p className="studio-eyebrow">On your calendar now</p><h2>{upcomingBookings.total} upcoming private {upcomingBookings.total === 1 ? 'booking' : 'bookings'}</h2><p>Saved private-booking dates on or after {shortDate(windows.today)}.</p><dl><div><dt>Linked to an inquiry</dt><dd>{upcomingBookings.linked}</dd></div><div><dt>Added directly to Calendar</dt><dd>{upcomingBookings.manual}</dd></div></dl><p>Calendar dates are separate from inquiry conversion. Public appearances and blocked dates are not included.</p><a className="studio-button outline" href="#calendar"><CalendarDays size={17} aria-hidden="true"/>Open calendar<ArrowRight size={16} aria-hidden="true"/></a></article>
    </div>
    <section className="snapshot-next" aria-labelledby="snapshot-next-heading"><div className="deck-section-heading"><div><h2 id="snapshot-next-heading">The rest of the picture</h2><p>Missing data stays missing—not a misleading zero.</p></div></div><div className="snapshot-not-connected">
      <article><span className="studio-pill">Not connected</span><h3>Website visits & daily average</h3><p>Visitor analytics is not connected to this snapshot. Visits, unique people, and visitor-to-inquiry conversion are unavailable.</p></article>
      <article><span className="studio-pill">Not configured</span><h3>Booking value & payments</h3><p>Booking amounts and collected payments are not recorded here. A booking is not cash received.</p></article>
      <article><span className="studio-pill">Not available yet</span><h3>Return on investment</h3><p>True ROI needs attributed revenue and costs. Inquiry conversion alone does not measure ROI.</p></article>
    </div></section>
    <details className="snapshot-methods"><summary>How these numbers work</summary><div><p>Last refreshed <time dateTime={asOf}>{refreshLabel}</time>. Use Refresh desk for a new snapshot. The 30-day comparisons end yesterday in New York so both windows contain complete local calendar days, including across daylight saving changes.</p><p>Inquiry counts use the saved received timestamp, never the requested event date. Booked counts use the current exact Booked status; no booking-status history exists, so this cannot report when a booking was confirmed. Follow-up means still marked New, not a verified missed call or promised due date.</p><p>{followUps.oldestAgeDays === null ? 'No valid age is available for the current New queue.' : `Oldest New inquiry: ${followUps.oldestAgeDays} calendar days since receipt.`}{followUps.unknownAgeCount > 0 ? ` ${followUps.unknownAgeCount} New inquiries have an unknown or future received time; they remain in the queue but have no age.` : ''}</p><p>{snapshot.excludedInquiryCount} known TEST inquiries and {snapshot.excludedEventCount} known TEST calendar entries excluded. The filter recognizes the explicit TEST ONLY training prefixes, the exact legacy TEST Deployment Check name, and the reserved example.test email domain. Calendar entries linked to excluded inquiries are excluded too. It does not hide legitimate names containing “test”. Training records remain visible in Booking Desk and Calendar.</p>{dateIssues > 0 && <p className="snapshot-data-warning" role="status">Date check: {snapshot.invalidCreatedAtCount} inquiries have invalid or ambiguous received timestamps and {snapshot.futureCreatedAtCount} have future received timestamps. They are excluded from dated inquiry metrics.</p>}{snapshot.invalidEventDateCount > 0 && <p className="snapshot-data-warning" role="status">{snapshot.invalidEventDateCount} calendar entries have invalid dates and are excluded from upcoming counts.</p>}<p>Only records saved in Studio are included. This view does not read analytics, email, payments, phone calendars, or testimonials, and it does not change any record.</p></div></details>
  </section>;
}
