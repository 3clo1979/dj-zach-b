// Public UI/API contract. Bump the version if the publication permission changes.
export const TESTIMONIAL_CONSENT_VERSION = '2026-10-22-v1';
export const testimonialEventTypes = ['Wedding', 'Private party', 'Corporate event', 'Public appearance', 'Other celebration'] as const;
export const testimonialStatuses = ['Pending', 'Published', 'Archived'] as const;
export type TestimonialStatus = typeof testimonialStatuses[number];
export type PublicTestimonial = {
  id: string;
  displayName: string;
  eventType: string;
  message: string;
  publishedAt: string;
};
