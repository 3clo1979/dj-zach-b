import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const inquiries = sqliteTable('inquiries', {
 id:text('id').primaryKey(), name:text('name').notNull(),email:text('email').notNull(),phone:text('phone').notNull(),date:text('date').notNull(),venue:text('venue').notNull(),eventType:text('event_type').notNull(),guests:text('guests').notNull(),hours:text('hours').notNull(),services:text('services').notNull(),message:text('message').notNull(),status:text('status').notNull().default('New'),createdAt:text('created_at').notNull()
});
export const events=sqliteTable('events',{
 id:text('id').primaryKey(),title:text('title').notNull(),date:text('date').notNull().unique(),start:text('start').notNull(),end:text('end').notNull(),venue:text('venue').notNull(),type:text('type').notNull(),isPublic:integer('is_public',{mode:'boolean'}).notNull().default(false),facebook:text('facebook').notNull().default(''),notes:text('notes').notNull().default('')
});
