// Private event details. Public events and calendar downloads never select these
// new fields implicitly; keep those destinations on explicit projections.
export const eventDetailLimits = {
  servicePlan: 3000,
  contactName: 120,
  contactEmail: 200,
  contactPhone: 40,
  // Legacy inquiry conversion prefixed services to a 3,000-character message.
  // Preserve those existing notes instead of truncating them in the new editor.
  notes: 6000,
} as const;

export type EventDetails = {
  servicePlan: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
};

export const blankEventDetails: EventDetails = {
  servicePlan: '', contactName: '', contactEmail: '', contactPhone: '', notes: '',
};

export function inquiryServicePlan(value: string): string {
  try {
    const services: unknown = JSON.parse(value);
    return Array.isArray(services) ? services.filter((item): item is string => typeof item === 'string').join('\n') : '';
  } catch { return ''; }
}

// Legacy inquiries allowed line breaks in name/phone. Prefill a valid single-line
// contact without changing the original inquiry, title, or any saved overrides.
export function contactLine(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}
