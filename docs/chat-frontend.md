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
| `GET /chat/threads/:threadId/messages?after=<msgId>&limit=<1–200, default 100>` | TEACHER, STUDENT | Cursor-paginated, **ascending**; `404` thread / `403` not a participant |
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
   on your own messages as "seen". Unread count per thread = counterparty
   messages with `readAt == null` (frontend-computed; the backend has no
   aggregate).
4. Load older: when scrolled to top and `nextCursor != null`,
   `GET .../messages?after=<nextCursor>&limit=100` and **prepend** (results
   are ascending, so they go before existing items).

## Rules to code against

- Threads are strictly pairwise: only the class teacher and the enrolled
  student can read/send/read-mark in a thread (`403` otherwise).
- Students create threads only for classes where they're **approved**;
  teachers only for students in their own classes.
- Auth failures are `401`; authorization failures are `403` — reuse the
  existing interceptor's messages.

## Frontend work list

1. `npm i socket.io-client`
2. Add chat types + 5 API functions to `src/lib/api.ts`
   (or regenerate `api-schema.ts` first)
3. `ChatListPage` (teacher + student, role-aware peer label)
4. `ChatThreadPage` (WS join/send, dedupe, read receipts, older-messages
   pagination)
5. Entry points: student class page button; teacher class detail /
   students list action; "Messages" nav item for both roles
6. New routes under both role groups in `router.tsx` (e.g. `/chat` and
   `/chat/:threadId`)
