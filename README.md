# OT vs CRDT — Collaborative Text Editor Demo

> A hands-on educational project implementing both **Operational Transformation (OT)**
> and **CRDT (Logoot)** from scratch, so you can understand how real-time collaborative
> editors like Google Docs, Notion, and Figma work under the hood.

---

## 🎯 Project Goal

This project teaches you the two dominant approaches to **real-time collaborative editing**:

1. **Operational Transformation (OT)** — the classic server-centric algorithm
2. **CRDT (Conflict-free Replicated Data Types)** — the modern peer-to-peer approach

Both are implemented from first principles (no external CRDT/OT libraries), with heavy
comments explaining every design decision.

---

## 📚 What Is Operational Transformation?

**Operational Transformation** is an algorithm invented in 1989 (Ellis & Gibbs) and made
famous by Google Wave and early Google Docs.

### The Problem It Solves

When two users type simultaneously in a shared document, their edits create **conflicts**:

```
Document: "Hello"
User A types "X" at position 2  → wants "HeXllo"
User B types "Y" at position 2  → wants "HeYllo"

Naïve apply: apply A then B naively → "HeYXllo" ❌ (Y went to the wrong place!)
```

### How OT Fixes This

Instead of storing edits as simple "position + character" pairs, OT **transforms**
each operation to account for concurrent edits:

```
Server receives A's op: insert "X" at pos 2 → applies it → "HeXllo"
Server receives B's op: insert "Y" at pos 2 — BUT it was concurrent with A!
  → Transform B against A: since A inserted at pos 2 (same as B), and A has lower clientId
  → B's position shifts to 3
  → Apply: "HeXllo" → insert "Y" at pos 3 → "HeXYllo" ✅
```

### Key Properties

| Property | Description |
|----------|-------------|
| **Server-centric** | Server is the authority; it transforms all ops |
| **Version numbers** | Every client tracks a version counter |
| **Transformation** | `transform(op1, op2)` adjusts positions |
| **Ordering** | Operations must arrive in order at the server |

### Advantages

✅ Well-understood algorithm (30+ years of research)  
✅ Works well with centralized server architecture  
✅ Efficient: operations are small (just position + characters)  
✅ Cursor preservation is straightforward  

### Disadvantages

❌ Server is a **single point of failure**  
❌ Complex transformation logic (especially for rich text)  
❌ Difficult to implement correctly (many edge cases)  
❌ Poor offline support (needs server to resolve conflicts)  
❌ Doesn't scale well to peer-to-peer scenarios  

---

## 📚 What Is CRDT?

**CRDT (Conflict-free Replicated Data Type)** is a data structure designed so that
concurrent updates **automatically converge** to the same state on all clients,
without any central coordination.

The Logoot variant (implemented here) was published in 2009 by Weiss et al.

### The Core Idea

Instead of storing a document as a plain string with mutable positions, a Logoot
document stores each character with a **permanent, globally-unique identifier**:

```
Document: "Hi"
Entry 0: { id: [0.3, "client-A", 1], char: "H" }
Entry 1: { id: [0.7, "client-A", 2], char: "i" }

Insert "!" at end:
  New ID = midpoint(0.7, 1.0) = 0.85  with jitter
  Entry 2: { id: [0.85, "client-B", 1], char: "!" }

Delete "H":
  Find entry with id [0.3, "client-A", 1] and remove it
  → No position arithmetic needed!
```

Because IDs are **totally ordered** (position → siteId → clock), every client that
receives the same set of inserts/deletes will sort them in the same order →
**automatic convergence**.

### Key Properties

| Property | Description |
|----------|-------------|
| **Commutativity** | `A then B = B then A` (order doesn't matter) |
| **Idempotency** | Applying the same op twice = applying once |
| **No version numbers** | IDs are globally unique; no coordination needed |
| **Server as relay** | Server doesn't need to understand operations |

### Advantages

✅ **No transformation logic** — server is a dumb relay  
✅ **Offline-first** — buffer ops locally, sync when reconnected  
✅ **Scales to peer-to-peer** — no central server required  
✅ **Simpler conflict resolution** — no "diamond" transformation problem  
✅ **Proven correctness** — convergence is guaranteed by math  

### Disadvantages

❌ **Higher memory** — storing (ID, char) pairs instead of a plain string  
❌ **ID space can degrade** — with many inserts, float precision can run low  
❌ **Deletion without tombstones is tricky** — need to handle out-of-order deletes  
❌ **Learning curve** — understanding ID allocation takes time  
❌ **Larger messages** — each op carries a full ID object  

---

## ⚖️ OT vs CRDT: Side-by-Side Comparison

| Feature | OT | CRDT (Logoot) |
|---------|-----|---------------|
| **Server role** | Smart transformer | Dumb relay |
| **Offline support** | Limited | Excellent |
| **Message size** | Small (position + chars) | Larger (full ID object) |
| **Memory per char** | O(1) | O(ID size) |
| **Conflict resolution** | Server-side transform | Math (ID ordering) |
| **Real systems** | Early Google Docs, SharePoint | Figma, Notion, CRDTs in general |
| **Peer-to-peer ready** | No (needs server) | Yes |
| **Implementation difficulty** | Hard | Medium (simpler at scale) |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        server.js                            │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   Express HTTP       │    │  WebSocket Routing       │   │
│  │  GET /  → index.html │    │  /ws/ot   → OT handler   │   │
│  │  GET /ot → ot.html   │    │  /ws/crdt → CRDT handler │   │
│  │  GET /crdt→crdt.html │    └──────────────────────────┘   │
│  └─────────────────────┘                                    │
│                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │     OT Engine           │  │    CRDT Engine           │  │
│  │  ot/ot-engine.js        │  │  crdt/logoot-id.js       │  │
│  │  ot/ot-document.js      │  │  crdt/logoot-document.js │  │
│  │                         │  │                          │  │
│  │  - Operation class      │  │  - LogootID class        │  │
│  │  - transformOp()        │  │  - generateIDBetween()   │  │
│  │  - applyOp()            │  │  - insert() / delete()   │  │
│  │  - OTDocument (server)  │  │  - Auto-sorting by ID    │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              │                              │
              │ WebSocket                    │ WebSocket
              ▼                              ▼
    ┌──────────────────┐          ┌──────────────────┐
    │   ot.html        │          │   crdt.html       │
    │                  │          │                   │
    │ - Local OT state │          │ - Local Logoot    │
    │ - deriveOp()     │          │   document        │
    │ - transformOp()  │          │ - generateID()    │
    │   (client-side)  │          │ - ID inspector    │
    │ - Lag simulation │          │ - Lag simulation  │
    └──────────────────┘          └──────────────────┘
```

### Data Flow — OT

```
Client A types "X"
    │
    ▼
Create op: { type: "insert", position: 3, chars: "X", clientVersion: 2 }
    │
    ▼ WebSocket send
Server receives op
    │
    ▼
Transform against ops since version 2 (history[2], history[3], ...)
    │
    ▼
Apply transformed op to server document
Increment serverVersion
    │
    ▼ Broadcast transformed op to ALL other clients
Client B receives: { type: "insert", position: 5, chars: "X", serverVersion: 4 }
    │
    ▼
Client B applies op to local document
→ Both clients now have identical documents ✅
```

### Data Flow — CRDT

```
Client A types "X"
    │
    ▼
Find neighbours in sorted entries array
Generate new LogootID between neighbours: [0.623..., "client-A", 5]
Insert into local sorted array
    │
    ▼ WebSocket send: { type: "insert", id: {...}, char: "X" }
Server receives → stores in server-side LogootDocument → relays to ALL other clients
    │
    ▼
Client B receives: { type: "insert", id: {...}, char: "X" }
    │
    ▼
Client B finds correct position by binary search in sorted array
Inserts { id, char } at that position
→ Both clients now have identical documents ✅
(No transformation needed — the ID encodes the position!)
```

---

## 📁 File Structure

```
OT_CRDT/
├── server.js                   # Unified HTTP + WebSocket server
├── package.json
│
├── ot/
│   ├── ot-engine.js            # transformOp(), applyOp(), Operation class
│   └── ot-document.js          # Server-side OT document + history
│
├── crdt/
│   ├── logoot-id.js            # LogootID class + generateIDBetween()
│   └── logoot-document.js      # LogootDocument: sorted array of {id, char}
│
├── public/
│   ├── index.html              # Landing page
│   ├── ot.html                 # OT demo (live collaboration + op log)
│   ├── crdt.html               # CRDT demo (live collaboration + ID inspector)
│   └── shared.css              # Styles
│
└── tests/
    ├── ot.test.js              # 18 OT unit tests
    └── crdt.test.js            # 19 CRDT unit tests
```

---

## 🚀 Setup Instructions

### Prerequisites

- **Node.js** v18 or newer  
- **npm** (comes with Node.js)

### Install

```bash
cd OT_CRDT
npm install
```

### Start the Server

```bash
npm start
```

You'll see:
```
╔══════════════════════════════════════════════════════╗
║        OT & CRDT Collaborative Editor Demo           ║
╠══════════════════════════════════════════════════════╣
║  Server running on http://localhost:3000             ║
║                                                      ║
║  OT  Demo  → http://localhost:3000/ot               ║
║  CRDT Demo → http://localhost:3000/crdt             ║
╚══════════════════════════════════════════════════════╝
```

### Run Tests

```bash
npm test
```

---

## 🧪 Testing Collaboration

### OT Demo

1. Open `http://localhost:3000/ot` in **two browser tabs**
2. Type in one tab — watch it appear instantly in the other tab
3. Check the **Operation Log** at the bottom to see each op being sent/received
4. **Enable "Simulate network lag"** in one tab (e.g. 1000ms)
5. Type quickly in **both tabs** at the same position
6. Watch the server **transform** the delayed op to the correct position
7. Both tabs should end up with the **same text** — that's OT convergence!

### CRDT Demo

1. Open `http://localhost:3000/crdt` in **two browser tabs**
2. Type in one tab — watch it appear in the other
3. Check the **CRDT State Inspector** (right panel) to see each character's LogootID
4. Notice that:
   - Your characters are shown in **green** (mine)
   - Remote characters are shown in **blue** (remote)
   - IDs are floating-point numbers allocated between neighbours
5. **Enable lag** and type simultaneously in both tabs at the same position
6. Both inserts will be accepted — the ID ordering determines the final character order
7. Unlike OT, the **server did zero transformation work** — it just relayed the messages

### Demonstrating CRDT Commutativity

1. Enable **maximum lag (3000ms)** in Tab B
2. Type "AAA" in Tab A (fast)
3. Then type "BBB" in Tab B before Tab A's messages arrive
4. Watch: Tab B will receive Tab A's messages 3 seconds later
5. The CRDT sorts everything by ID — **the final result is the same** regardless of order

---

## 🔄 How Collaboration Works

### OT Synchronization

```
Client A (version 3)               Server (version 3)
     |                                    |
     | -- insert "X" at pos 5, v3 -----→ |  (concurrent with op at v3 on server!)
     |                                    |  Transform against history[3]
     |                                    |  New position: 7
     |                                    |  Apply: content updated
     | ←----------- ack (v4) ----------- |
     |                                    |
     |                                    |-- broadcast insert "X" at pos 7 (v4) →
     |                                    |
                                    Client B receives transformed op at pos 7
                                    Applies it → same document as Server and Client A ✅
```

### CRDT Synchronization

```
Client A (site "uuid-A")           Server (relay)
     |                                    |
     | -- insert { id:[0.6,"A",1], "X" } →|  Store in server-side doc
     |                                    |-- relay same message unchanged →
     |                                    |
                                    Client B receives: { id:[0.6,"A",1], "X" }
                                    Binary search: finds position for 0.6 in sorted array
                                    Inserts { id, char } → same document as Client A ✅
                                    (No transformation. Server did nothing.)
```

---

## 🌐 Real Systems That Use These Algorithms

### Systems Using Operational Transformation

| System | Notes |
|--------|-------|
| **Google Docs (early)** | OT on Google Wave; later moved to CRDT concepts |
| **Microsoft SharePoint** | OT for collaborative document editing |
| **Apache Wave** | Open-source Google Wave clone with OT |
| **Etherpad** | Open-source collaborative editor using OT |

### Systems Using CRDT

| System | Notes |
|--------|-------|
| **Figma** | CRDT for real-time design collaboration |
| **Notion** | Custom CRDT for block-based documents |
| **Linear** | CRDT for issue tracking and collaborative editing |
| **Automerge** | Open-source CRDT library (used in many apps) |
| **Yjs** | High-performance CRDT library for JavaScript |
| **Redis (CRDT mode)** | Distributed key-value with CRDT semantics |
| **Riak** | Distributed database with CRDT data types |

---

## 📖 Learning Summary

### OT in One Sentence

> "When two edits conflict, **transform** the later one's position to account for the earlier one, so both edits produce the intended result."

### CRDT in One Sentence

> "Give every character a **unique, ordered ID** so that all clients, receiving operations in any order, sort them identically and automatically converge."

### When to Use OT

- You have a **centralized server** architecture
- You need **small operation sizes** (bandwidth-constrained)
- Your document model is **simple text** (not rich hierarchical structures)
- You're building a **traditional web app** (not offline-first)

### When to Use CRDT

- You need **offline-first** or **peer-to-peer** editing
- You want **no single point of failure**
- Your document may have **complex structure** (trees, graphs)
- You need **automatic conflict resolution** without a smart server
- You're building a **distributed system** at scale

### The Modern Recommendation

For most new collaborative applications, **CRDT is preferred** because:
1. Offline support is increasingly expected by users
2. CRDT implementations (Yjs, Automerge) have matured and are fast
3. The server is simpler and cheaper (just a relay)
4. No correctness bugs from complex transformation logic
5. Scales naturally to peer-to-peer scenarios (e.g., local network sync)
