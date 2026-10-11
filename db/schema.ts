import { bigint, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

// Document store used by the booking page (collections: movies, bookings, users, meta).
export const documents = pgTable(
  'documents',
  {
    collection: text('collection').notNull(),
    id: text('id').notNull(),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collection, t.id] })],
)

// Short-lived locks so concurrent bookings cannot grab the same seat.
export const locks = pgTable('locks', {
  name: text('name').primaryKey(),
  holder: text('holder').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
})
