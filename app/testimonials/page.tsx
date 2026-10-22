import type { Metadata } from 'next';
import TestimonialForm from './testimonial-form';

export const metadata: Metadata = {
  title: 'Share your experience | DJ Zach B',
  description: 'Share an honest account of your experience with DJ Zach B. Testimonials are reviewed before publication, with your permission.',
};

export default function TestimonialsPage() {
  return <TestimonialForm />;
}
