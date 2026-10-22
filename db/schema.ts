import { blob, check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const inquiries = sqliteTable('inquiries', {
 id:text('id').primaryKey(), name:text('name').notNull(),email:text('email').notNull(),phone:text('phone').notNull(),date:text('date').notNull(),venue:text('venue').notNull(),eventType:text('event_type').notNull(),guests:text('guests').notNull(),hours:text('hours').notNull(),services:text('services').notNull(),message:text('message').notNull(),status:text('status').notNull().default('New'),createdAt:text('created_at').notNull(),
 referralSource:text('referral_source'),referralOther:text('referral_other'),
 quotedAmountCents:integer('quoted_amount_cents'),bookedAmountCents:integer('booked_amount_cents'),
 revision:text('revision').notNull().default('legacy'),changedAt:text('changed_at'),changedBy:text('changed_by')
}, t => [
 check('inquiry_referral_source', sql`${t.referralSource} IS NULL OR ${t.referralSource} IN ('Google','Social media','Friend / family','Venue / vendor','Returning client','Other')`),
 check('inquiry_referral_other', sql`${t.referralOther} IS NULL OR (${t.referralSource} IS NOT NULL AND ${t.referralSource} = 'Other' AND length(${t.referralOther}) <= 160)`),
 check('inquiry_quoted_amount', sql`${t.quotedAmountCents} IS NULL OR (typeof(${t.quotedAmountCents}) = 'integer' AND ${t.quotedAmountCents} BETWEEN 0 AND 99999999)`),
 check('inquiry_booked_amount', sql`${t.bookedAmountCents} IS NULL OR (typeof(${t.bookedAmountCents}) = 'integer' AND ${t.bookedAmountCents} BETWEEN 0 AND 99999999)`),
]);

export const testimonials = sqliteTable('testimonials', {
 id: text('id').primaryKey(),
 submissionKey: text('submission_key').notNull().unique(),
 displayName: text('display_name').notNull(),
 email: text('email').notNull(),
 eventType: text('event_type').notNull(),
 message: text('message').notNull(),
 status: text('status', { enum: ['Pending', 'Published', 'Archived'] }).notNull().default('Pending'),
 consentAt: text('consent_at').notNull(),
 consentVersion: text('consent_version').notNull(),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull(),
 publishedAt: text('published_at'),
 moderatedAt: text('moderated_at'),
 moderatedBy: text('moderated_by'),
}, t => [
 index('testimonials_status_created_idx').on(t.status, t.createdAt),
 check('testimonial_status_valid', sql`${t.status} IN ('Pending', 'Published', 'Archived')`),
 check('testimonial_publication_valid', sql`${t.status} != 'Published' OR (${t.publishedAt} IS NOT NULL AND ${t.moderatedAt} IS NOT NULL AND ${t.moderatedBy} IS NOT NULL)`),
]);

export const testimonialAudit = sqliteTable('testimonial_audit', {
 id: integer('id').primaryKey({ autoIncrement: true }),
 testimonialId: text('testimonial_id').notNull().references(() => testimonials.id),
 fromStatus: text('from_status'),
 toStatus: text('to_status').notNull(),
 actor: text('actor'),
 createdAt: text('created_at').notNull(),
}, t => [index('testimonial_audit_item_idx').on(t.testimonialId, t.createdAt)]);

export const testimonialRateLimits = sqliteTable('testimonial_rate_limits', {
 key: text('key').primaryKey(),
 count: integer('count').notNull(),
 expiresAt: integer('expires_at').notNull(),
}, t => [index('testimonial_rate_expiry_idx').on(t.expiresAt)]);
export const events=sqliteTable('events',{
 id:text('id').primaryKey(),title:text('title').notNull(),date:text('date').notNull().unique(),start:text('start').notNull(),end:text('end').notNull(),venue:text('venue').notNull(),type:text('type').notNull(),isPublic:integer('is_public',{mode:'boolean'}).notNull().default(false),facebook:text('facebook').notNull().default(''),notes:text('notes').notNull().default(''),
 // NULL means an older event has not initialized its private details yet.
 // An explicit empty string is an intentional clear, never an inquiry fallback.
 servicePlan:text('service_plan'),contactName:text('contact_name'),contactEmail:text('contact_email'),contactPhone:text('contact_phone'),revision:text('revision').notNull().default('legacy')
});

// Never selected by public APIs. The original photo is not a bundled/static asset.
export const studioPhoto = sqliteTable('studio_photo', {
 id: integer('id').primaryKey(),
 bytes: blob('bytes', { mode: 'buffer' }).notNull(),
 contentType: text('content_type', { enum: ['image/jpeg', 'image/png'] }).notNull(),
 version: text('version').notNull(),
 updatedAt: text('updated_at').notNull(),
}, t => [
 check('studio_photo_singleton', sql`${t.id} = 1`),
 check('studio_photo_size', sql`length(${t.bytes}) BETWEEN 1 AND 1000000`),
 check('studio_photo_type', sql`${t.contentType} IN ('image/jpeg', 'image/png')`),
]);


// Stable inquiry identity survives cancel/rebook and calendar-entry deletion.
export const financialRecords = sqliteTable('financial_records', {
 id: text('id').primaryKey(),
 inquiryId: text('inquiry_id').notNull().references(() => inquiries.id),
 kind: text('kind', { enum: ['payment', 'refund'] }).notNull(),
 amountCents: integer('amount_cents').notNull(),
 paidOn: text('paid_on').notNull(),
 method: text('method', { enum: ['Venmo', 'PayPal', 'Cash', 'Stripe', 'Other'] }).notNull(),
 createdAt: text('created_at').notNull(), createdBy: text('created_by').notNull(),
 voidedAt: text('voided_at'), voidedBy: text('voided_by'), voidReason: text('void_reason'),
}, t => [
 index('financial_records_inquiry_idx').on(t.inquiryId, t.createdAt),
 check('financial_record_amount', sql`typeof(${t.amountCents}) = 'integer' AND ${t.amountCents} BETWEEN 1 AND 99999999`),
 check('financial_record_kind', sql`${t.kind} IN ('payment', 'refund')`),
 check('financial_record_method', sql`${t.method} IN ('Venmo', 'PayPal', 'Cash', 'Stripe', 'Other')`),
 check('financial_record_void', sql`(${t.voidedAt} IS NULL AND ${t.voidedBy} IS NULL AND ${t.voidReason} IS NULL) OR (${t.voidedAt} IS NOT NULL AND ${t.voidedBy} IS NOT NULL AND ${t.voidReason} IS NOT NULL AND length(${t.voidReason}) BETWEEN 1 AND 300)`),
]);
export const inquiryStatusHistory = sqliteTable('inquiry_status_history', {
 id: integer('id').primaryKey({ autoIncrement: true }),
 inquiryId: text('inquiry_id').notNull().references(() => inquiries.id),
 fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
 createdAt: text('created_at').notNull(), actor: text('actor'),
}, t => [index('inquiry_status_history_item_idx').on(t.inquiryId, t.createdAt)]);
export const inquiryAmountHistory = sqliteTable('inquiry_amount_history', {
 id: integer('id').primaryKey({ autoIncrement: true }),
 inquiryId: text('inquiry_id').notNull().references(() => inquiries.id),
 fromQuotedCents: integer('from_quoted_cents'), toQuotedCents: integer('to_quoted_cents'),
 fromBookedCents: integer('from_booked_cents'), toBookedCents: integer('to_booked_cents'),
 createdAt: text('created_at').notNull(), actor: text('actor').notNull(),
}, t => [index('inquiry_amount_history_item_idx').on(t.inquiryId, t.createdAt)]);
export const financeRateLimits = sqliteTable('finance_rate_limits', {
 key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull(),
}, t => [index('finance_rate_expiry_idx').on(t.expiresAt)]);
