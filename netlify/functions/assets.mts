import { getStore } from '@netlify/blobs'

const MAX_BYTES = 8 * 1024 * 1024
const ID_RE = /^[a-z0-9-]{8,64}$/

const store = () => getStore({ name: 'assets', consistency: 'strong' })

export default async (req: Request, context: { params: Record<string, string> }) => {
  const id = context.params?.id

  if (req.method === 'GET') {
    if (!id || !ID_RE.test(id)) return new Response('Not found', { status: 404 })
    const entry = await store().getWithMetadata(id, { type: 'arrayBuffer' })
    if (!entry) return new Response('Not found', { status: 404 })
    return new Response(entry.data, {
      headers: {
        'Content-Type': String(entry.metadata?.contentType || 'application/octet-stream'),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  if (req.method === 'POST' && !id) {
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return Response.json({ error: 'Images only' }, { status: 415 })
    const buf = await req.arrayBuffer()
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }
    const newId = crypto.randomUUID()
    await store().set(newId, buf, { metadata: { contentType } })
    return Response.json({ id: newId }, { status: 201 })
  }

  if (req.method === 'DELETE' && id) {
    if (!ID_RE.test(id)) return Response.json({ error: 'Invalid id' }, { status: 400 })
    await store().delete(id)
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config = { path: ['/api/assets', '/api/assets/:id', '/_blob/:id'] }
