import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { documents, locks } from '../../db/schema.js'

const COLLECTIONS = new Set(['movies', 'bookings', 'users', 'meta', 'holds'])

// Seat holds ("in progress" during payment) expire on the server clock so client clock skew can't keep seats locked.
const HOLD_MIN_MS = 30_000
const HOLD_MAX_MS = 15 * 60_000

const json = (body: unknown, status = 200) => Response.json(body, { status })

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { op, collection, id, data } = body ?? {}
  if (typeof collection !== 'string' || !COLLECTIONS.has(collection)) {
    return json({ error: 'Unknown collection' }, 400)
  }
  const needsId = op !== 'list'
  if (needsId && (typeof id !== 'string' || !id || id.length > 200)) {
    return json({ error: 'Invalid id' }, 400)
  }
  const isObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v)

  try {
    switch (op) {
      case 'list': {
        if (collection === 'holds') {
          await db
            .delete(documents)
            .where(
              and(
                eq(documents.collection, 'holds'),
                sql`(${documents.data}->>'expiresAt')::bigint < ${Date.now()}`,
              ),
            )
        }
        const rows = await db
          .select({ id: documents.id, data: documents.data })
          .from(documents)
          .where(eq(documents.collection, collection))
        return json({ docs: rows })
      }

      case 'get': {
        const [row] = await db
          .select({ data: documents.data })
          .from(documents)
          .where(and(eq(documents.collection, collection), eq(documents.id, id)))
        return json({ exists: !!row, data: row?.data ?? null })
      }

      case 'set': {
        if (!isObject(data)) return json({ error: 'Invalid data' }, 400)
        if (collection === 'holds') {
          const ttlMs = Math.min(Math.max(Number(data.ttlMs) || HOLD_MAX_MS, HOLD_MIN_MS), HOLD_MAX_MS)
          data.expiresAt = Date.now() + ttlMs
          delete data.ttlMs
        }
        await db
          .insert(documents)
          .values({ collection, id, data })
          .onConflictDoUpdate({
            target: [documents.collection, documents.id],
            set: { data, updatedAt: new Date() },
          })
        return json({ ok: true })
      }

      case 'update': {
        if (!isObject(data)) return json({ error: 'Invalid data' }, 400)
        const updated = await db
          .update(documents)
          .set({
            data: sql`${documents.data} || ${JSON.stringify(data)}::jsonb`,
            updatedAt: new Date(),
          })
          .where(and(eq(documents.collection, collection), eq(documents.id, id)))
          .returning({ id: documents.id })
        if (!updated.length) return json({ error: 'Document not found' }, 404)
        return json({ ok: true })
      }

      case 'delete': {
        await db
          .delete(documents)
          .where(and(eq(documents.collection, collection), eq(documents.id, id)))
        return json({ ok: true })
      }

      case 'acquire': {
        // Atomically take the lock if it is free or its previous holder's TTL expired.
        const holder = String(body.holder ?? '').slice(0, 200)
        const ttlMs = Math.min(Math.max(Number(body.ttlMs) || 4000, 500), 30000)
        const now = Date.now()
        const name = `${collection}/${id}`
        const rows = await db
          .insert(locks)
          .values({ name, holder, expiresAt: now + ttlMs })
          .onConflictDoUpdate({
            target: locks.name,
            set: { holder, expiresAt: now + ttlMs },
            setWhere: lt(locks.expiresAt, now),
          })
          .returning({ holder: locks.holder })
        return json({ acquired: rows.length > 0 })
      }

      default:
        return json({ error: 'Unknown op' }, 400)
    }
  } catch (error) {
    console.error('Database error:', error)
    return json({ error: 'Database error' }, 500)
  }
}

export const config = { path: '/api/db' }
