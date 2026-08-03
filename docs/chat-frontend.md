# Chat (Student ↔ Teacher) — Frontend Handoff

> Backend module: `src/chat/` — `ChatController`, `ChatService`, `ChatGateway`
> (Socket.io namespace `/chat`). This file is the contract the backend
> implements against. **Threads are strictly pairwise** — only the class
> teacher and the enrolled student can ever read or send in a thread.
> Last updated for teacher-initiated threads (POST `/chat/threads`).

---

## Data model (what the API returns)

| Concept | Details |
|---|---|
| `ChatThread` | One thread per **(teacher, student, class)** triple — unique constraint, so re-POSTing never duplicates |
| `ChatMessage` | `id, threadId, authorId, text, readAt (null until counterparty reads), createdAt` — all dates **ISO strings** |

## REST endpoints (base `http://localhost:3000`, no `/api` prefix)

| Method / Path | Roles | Purpose |
|---|---|---|
| `GET /chat/threads` | TEACHER, STUDENT | Current user's threads, newest-first by `updatedAt` |
| `POST /chat/threads` | STUDENT, TEACHER | **Create-or-get** a thread — see rules below |
| `GET /chat/threads/:threadId/messages?before=<msgId>&limit=<1–200, default 100>` | TEACHER, STUDENT | Cursor-paginated, oldest-first pages. **First call returns the LATEST messages** (opens at the bottom of the thread); `before=<msgId>` returns the page strictly older than that message. `404` thread / `403` not a participant |
| `POST /chat/threads/:threadId/messages` `{ text }` (1–4000 chars) | TEACHER, STUDENT | REST fallback for sending |
| `POST /chat/threads/:threadId/read` | TEACHER, STUDENT | Marks all **counterparty** messages (`authorId ≠ me`, `readAt = null`) as read |

### `POST /chat/threads` rules

Body: `{ classId: string, studentId?: string }`

- **Student** (no `studentId`): creates/gets the thread with the class teacher.
  `403` unless the student has an **APPROVED** enrollment in the class.
- **Teacher** (with `studentId`): creates/gets the thread with that student.
  `403` unless the caller **is the class owner** (`class.teacherId`) and the
  student has an **APPROVED** enrollment. Teacher-initiated threads let the
  teacher reach out first — the student sees it in their thread list.
- `404` when the class doesn't exist. `400` on invalid `classId`/`studentId`
  (must be UUIDs).

### Response shapes

```ts
interface ChatMessage {
  id: string; threadId: string; authorId: string;
  text: string; readAt: string | null; createdAt: string;
}
interface ChatThreadListItem {
  id: string; classId: string; teacherId: string; studentId: string;
  createdAt: string; updatedAt: string;
  className: string | null; peerId: string; peerName: string;
  lastMessage: string | null;            // preview for the list UI
  lastMessageAuthorId: string | null;    // null when thread has no messages
  unreadCount: number;                   // messages from the counterparty with readAt == null
}
interface ChatThread { /* POST /chat/threads response: id, classId, teacherId, studentId, createdAt, updatedAt */ }
interface MessagesPage { items: ChatMessage[]; nextCursor: string | null }
```

**Note**: the current `api-schema.ts` snapshot has **no chat types** (only
`/assistant/chat`) — regenerate from `GET http://localhost:3000/api-json`, or
add the types above manually.

## WebSocket (Socket.io — realtime)

- URL: `http://localhost:3000/chat` (namespace `/chat`, `cors: true`)
- **Auth**: `io(API_URL + "/chat", { auth: { token: getStoredToken() } })` —
  the same Supabase JWT from localStorage (`eduai_token`). Also accepts an
  `Authorization: Bearer` header. Missing/invalid token → connection fails
  (`connect_error`, 401).
- Client → server:
   - `thread:join` `{ threadId }` — **server replies `thread:joined`
     `{ threadId, items }`** with the **last 50 messages ascending** (that's
     the initial load — no REST call needed on open)
  - `thread:leave` `{ threadId }`
  - `thread:send` `{ threadId, text }`
- Server → room `thread:<threadId>`: `thread:message` — the created
  `ChatMessage`. **The sender receives it too (no echo suppression)** —
  dedupe by `id` or treat the event as the canonical append.
- Socket.io reconnects on its own, but rooms are lost on reconnect —
  re-emit `thread:join` on the `connect` event if a thread is open.
- Joining a room validates participation — `thread:join` on a thread you
  don't belong to fails (`403` from the underlying `getMessages`).

## Suggested flow

**Student side**
1. Class page / student dashboard → "Message teacher" button →
   `POST /chat/threads { classId }` → open `/chat/:threadId`.
2. "Messages" nav item → `GET /chat/threads` → conversations
   (peer = teacher, plus class name + last-message preview).

**Teacher side**
1. Class detail / students list → "Message" →
   `POST /chat/threads { classId, studentId }` → open `/chat/:threadId`.
2. "Messages" nav item → `GET /chat/threads` → conversations
   (peer = student + their class).

**Inside the chat view (both roles)**
1. `socket.connect()`; `emit("thread:join", { threadId })` → render
   `thread:joined.items` (upsert into local state by `id`).
2. Send: `emit("thread:send", { threadId, text })` — append
   `thread:message` on receipt (dedupe by `id`). REST
   `POST .../messages` is the offline/fallback path.
3. Read receipts: on mount + whenever messages arrive while the tab is
   focused, call `POST /chat/threads/:threadId/read`; render `readAt != null`
   on your own messages as "seen". Unread state per thread comes from
   `unreadCount` on `GET /chat/threads` — badge conversations where it's
   `> 0`, clear it locally after opening the thread or calling `/read`.
   (`lastMessageAuthorId` lets you render a "You:" prefix on your own
   previews.)
4. Load older: when scrolled to top and `nextCursor != null`,
   `GET .../messages?before=<nextCursor>&limit=100` and **prepend** (results
   are ascending, so they go before existing items). The first page is the
   tail of the thread, so long threads open at the latest messages.

## Rules to code against

- Threads are strictly pairwise: only the class teacher and the enrolled
  student can read/send/read-mark in a thread (`403` otherwise).
- Students create threads only for classes where they're **approved**;
  teachers only for students in their own classes.
- Auth failures are `401`; authorization failures are `403` — reuse the
  existing interceptor's messages.
- `limit` is clamped server-side to `1–200` (default `100`) — strings are
  coerced, so the endpoint never 500s on a bad `limit`.
- **Known gap**: DTOs are documented but *not enforced* at runtime (no
  global validation pipe yet — being tracked as a separate task). The
  backend already rejects the realistic invalid inputs at the service
  level (unknown thread → 404, non-participant → 403, bad uuid cursor →
  empty page), so the frontend can treat this as a non-blocker.

## Frontend work list

1. `npm i socket.io-client`
2. Add chat types + 5 API functions to `src/lib/api.ts`
   (or regenerate `api-schema.ts` first) — note `unreadCount` /
   `lastMessageAuthorId` on thread list items and `before` on messages
3. `ChatListPage` (teacher + student, role-aware peer label, unread badges
   from `unreadCount`)
4. `ChatThreadPage` (WS join/send, dedupe, read receipts, older-messages
   pagination)
5. Entry points: student class page button; teacher class detail /
   students list action; "Messages" nav item for both roles
6. New routes under both role groups in `router.tsx` (e.g. `/chat` and
   `/chat/:threadId`)
