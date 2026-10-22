import { blob, check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const inquiries = sqliteTable('inquiries', {
 id:text('id').primaryKey(), name:text('name').notNull(),email:text('email').notNull(),phone:text('phone').notNull(),date:text('date').notNull(),venue:text('venue').notNull(),eventType:text('event_type').notNull(),guests:text('guests').notNull(),hours:text('hours').notNull(),services:text('services').notNull(),message:text('message').notNull(),status:text('status').notNull().default('New'),createdAt:text('created_at').notNull()
});

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
 id:text('id').primaryKey(),title:text('title').notNull(),date:text('date').notNull().unique(),start:text('start').notNull(),end:text('end').notNull(),venue:text('venue').notNull(),type:text('type').notNull(),isPublic:integer('is_public',{mode:'boolean'}).notNull().default(false),facebook:text('facebook').notNull().default(''),notes:text('notes').notNull().default('')
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
