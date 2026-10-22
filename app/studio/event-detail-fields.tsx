import { eventDetailLimits, type EventDetails } from '../event-details-contract';
import { contactPhoneHref } from './studio-data';

export function EventDetailSummary({ value }: { value: EventDetails }) {
  const phoneHref = contactPhoneHref(value.contactPhone);
  return <div className="event-private-details">
    <p className="event-private-hint">Private event details</p>
    {value.servicePlan && <section><h4>Services &amp; what I’m bringing</h4><p>{value.servicePlan}</p></section>}
    {value.notes && <section><h4>Notes &amp; special requests</h4><p>{value.notes}</p></section>}
    {(value.contactName || value.contactEmail || value.contactPhone) && <section><h4>Primary contact</h4>{value.contactName && <p>{value.contactName}</p>}<div className="event-contact-links">{value.contactEmail && <a href={'mailto:' + encodeURIComponent(value.contactEmail)}>Email {value.contactEmail}</a>}{value.contactPhone && (phoneHref ? <a href={phoneHref}>Call {value.contactPhone}</a> : <p>{value.contactPhone}</p>)}</div></section>}
    {!Object.values(value).some(Boolean) && <p>No private details yet. Add your services, notes, and contact.</p>}
  </div>;
}

export default function EventDetailFields({ value, onChange }: { value: EventDetails; onChange: (value: EventDetails) => void }) {
  const field = (name: keyof EventDetails, next: string) => onChange({ ...value, [name]: next });
  return <div className="event-detail-fields">
    <p className="event-private-hint">Private planning details — never shown on the public website.</p>
    <label>Services &amp; what I’m bringing<textarea name="servicePlan" maxLength={eventDetailLimits.servicePlan} rows={4} placeholder="DJ service, uplighting, photo booth… Add the equipment or extras you’re bringing." value={value.servicePlan} onChange={event => field('servicePlan', event.target.value)}/></label>
    <label>Notes &amp; special requests<textarea name="notes" maxLength={eventDetailLimits.notes} rows={5} placeholder="Setup details, special requests, extra contacts, and odds and ends." value={value.notes} onChange={event => field('notes', event.target.value)}/></label>
    <label>Primary contact<input name="contactName" maxLength={eventDetailLimits.contactName} autoComplete="off" value={value.contactName} onChange={event => field('contactName', event.target.value)}/></label>
    <div className="form-grid event-contact-grid">
      <label>Contact email<input name="contactEmail" type="email" maxLength={eventDetailLimits.contactEmail} autoComplete="off" value={value.contactEmail} onChange={event => field('contactEmail', event.target.value)}/></label>
      <label>Contact phone<input name="contactPhone" type="tel" maxLength={eventDetailLimits.contactPhone} autoComplete="off" value={value.contactPhone} onChange={event => field('contactPhone', event.target.value)}/></label>
    </div>
  </div>;
}
