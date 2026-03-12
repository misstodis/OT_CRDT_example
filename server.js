/**
 * server.js — Unified Socket.IO + HTTP Server
 * ============================================
 *
 * ARCHITECTURE:
 * -------------
 * This single server handles both OT and CRDT demos on different Socket.IO
 * NAMESPACES (instead of raw WebSocket paths):
 *
 *   HTTP  GET /              → serves index.html (landing page)
 *   HTTP  GET /ot            → serves ot.html (OT demo)
 *   HTTP  GET /crdt          → serves crdt.html (CRDT demo)
 *   Socket.IO  /ot           → OT namespace  (stateful server)
 *   Socket.IO  /crdt         → CRDT namespace (relay server)
 *
 * WHY SOCKET.IO INSTEAD OF RAW WEBSOCKET?
 * ----------------------------------------
 * Socket.IO adds several advantages on top of raw WebSocket:
 *   ✅ Automatic reconnection — if the connection drops, it reconnects
 *   ✅ Namespaces — clean logical separation of OT vs CRDT channels
 *   ✅ Rooms — easy grouping of sockets (useful for multi-document support)
 *   ✅ Event-based API — socket.emit('op', data) instead of JSON.stringify
 *   ✅ Fallback transports — uses long-polling if WebSocket is blocked
 *   ✅ Built-in acknowledgements — socket.emit('op', data, callback)
 *   ✅ Middleware support — easy to add auth, logging, etc.
 *
 * OT SERVER ROLE (Stateful):
 * --------------------------
 * Maintains the authoritative document state.
 * When it receives an 'op' event it:
 *   1. Transforms it against concurrent ops (using ot-engine)
 *   2. Applies it to the server document
 *   3. Broadcasts the TRANSFORMED op to all OTHER clients via socket.broadcast.emit
 *   4. Acknowledges the sender via a callback (Socket.IO ack)
 *
 * CRDT SERVER ROLE (Relay / Dumb Broadcast):
 * ------------------------------------------
 * Does NOT transform anything.
 * It simply relays every 'insert' / 'delete' event to all other clients.
 * Each client independently merges the CRDT op into its own sorted array.
 *
 * This architectural difference is KEY:
 *   OT   → Smart server required for transformation
 *   CRDT → Dumb relay; all intelligence is in the client
 */

const http    = require('http');
const express = require('express');
const path    = require('path');
const { Server } = require('socket.io');  // ← Socket.IO replaces 'ws'
const { v4: uuidv4 } = require('uuid');

// ─── Import OT and CRDT modules ─────────────────────────────────────────────
const { Operation } = require('./ot/ot-engine');
const { otDocument } = require('./ot/ot-document');
const { LogootID } = require('./crdt/logoot-id');
const { crdtDocument } = require('./crdt/logoot-document');

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ot',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'ot.html')));
app.get('/crdt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'crdt.html')));
app.get('/',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── HTTP + Socket.IO Server ─────────────────────────────────────────────────
const server = http.createServer(app);

/**
 * Create the Socket.IO server attached to the same HTTP server.
 *
 * cors: { origin: '*' } is fine for a local demo.
 * In production you would restrict this to your domain.
 */
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── OT Namespace: /ot ───────────────────────────────────────────────────────
/**
 * Socket.IO NAMESPACE = a logical channel. All OT clients connect to '/ot'.
 * This replaces the old wssOT WebSocket server and path-based routing.
 *
 * Key Socket.IO concepts used here:
 *   socket.emit(event, data)          → send to THIS socket only
 *   socket.broadcast.emit(event, data)→ send to ALL sockets EXCEPT this one
 *   io.of('/ot').emit(event, data)    → send to ALL sockets in /ot namespace
 */
const otNsp = io.of('/ot');

otNsp.on('connection', (socket) => {
  // Assign a unique client ID for this connection
  const clientId = uuidv4();
  console.log(`[OT] Client connected: ${clientId}`);

  /**
   * EVENT: 'join'
   * -------------
   * As soon as a client connects, we send it the current document state.
   * Socket.IO fires 'connection' immediately on connect, so we emit 'init'
   * right away — no need to wait for a separate join event.
   *
   * The client receives: { content, version, clientId }
   * It uses this to initialise its local OT state.
   */
  const state = otDocument.getState();
  socket.emit('init', {
    content:  state.content,
    version:  state.version,
    clientId: clientId
  });

  /**
   * EVENT: 'op'
   * -----------
   * A client sends an operation it wants to apply.
   * Payload: { type, position, chars, clientId, clientVersion }
   *
   * Socket.IO ACKNOWLEDGEMENT:
   * The client can pass a callback as the last argument to socket.emit().
   * We call ack({ serverVersion }) to confirm the op was applied.
   * This is cleaner than a separate 'ack' message type.
   */
  socket.on('op', (data, ack) => {
    try {
      // Reconstruct the Operation from the plain object the client sent
      const op = new Operation(
        data.type,
        data.position,
        data.chars,
        data.clientId,
        data.clientVersion
      );

      console.log(`[OT] op from ${clientId}: ${op.type} "${op.chars}" at pos ${op.position} (client v${op.clientVersion})`);

      /**
       * TRANSFORM + APPLY:
       * OTDocument.receiveOp() transforms the op against all concurrent
       * server-side ops, applies it, increments serverVersion, and returns
       * the transformed op.
       */
      const transformedOp = otDocument.receiveOp(op);

      console.log(`[OT] doc: "${otDocument.content}" (server v${otDocument.serverVersion})`);

      /**
       * BROADCAST the transformed op to every OTHER client in the /ot namespace.
       * socket.broadcast.emit() excludes the sender automatically.
       * Clients receive the op and apply it directly (server already transformed it).
       */
      socket.broadcast.emit('op', {
        type:          transformedOp.type,
        position:      transformedOp.position,
        chars:         transformedOp.chars,
        clientId:      transformedOp.clientId,
        serverVersion: transformedOp.serverVersion
      });

      /**
       * ACKNOWLEDGE the sender via the Socket.IO ack callback.
       * This tells the client its op was accepted and gives it the new server version.
       */
      if (typeof ack === 'function') {
        ack({ serverVersion: transformedOp.serverVersion });
      }

    } catch (err) {
      console.error('[OT] Error handling op:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[OT] Client disconnected: ${clientId}`);
  });
});

// ─── CRDT Namespace: /crdt ───────────────────────────────────────────────────
/**
 * Socket.IO NAMESPACE '/crdt'.
 * The CRDT server is a pure relay — it stores state only to catch up
 * newly-joining clients, but does ZERO transformation work.
 *
 * Contrast with /ot above: this handler is much simpler because
 * CRDT's commutativity means operations can be forwarded as-is.
 */
const crdtNsp = io.of('/crdt');

crdtNsp.on('connection', (socket) => {
  const clientId = uuidv4();
  console.log(`[CRDT] Client connected: ${clientId}`);

  /**
   * Send the full current CRDT state to the new client.
   * The client reconstructs its local LogootDocument from these entries.
   */
  socket.emit('init', {
    entries:  crdtDocument.getEntries(),
    clientId: clientId
  });

  /**
   * EVENT: 'insert'
   * ---------------
   * A client inserted a character. Payload: { id: LogootID, char }
   *
   * We:
   *   1. Apply to the server-side CRDT document (for catch-up of future clients)
   *   2. Relay unchanged to all other clients
   *
   * NO transformation. The LogootID encodes the position permanently.
   */
  socket.on('insert', (data) => {
    try {
      const id = LogootID.fromJSON(data.id);
      console.log(`[CRDT] insert "${data.char}" id=${JSON.stringify(data.id)}`);
      crdtDocument.insert(id, data.char);

      // Relay to everyone else in /crdt — no modification
      socket.broadcast.emit('insert', { id: data.id, char: data.char });
    } catch (err) {
      console.error('[CRDT] Error handling insert:', err);
    }
  });

  /**
   * EVENT: 'delete'
   * ---------------
   * A client deleted a character by its LogootID. Payload: { id: LogootID }
   *
   * We apply to the server doc and relay. No position adjustment needed —
   * the ID permanently and uniquely identifies the character.
   */
  socket.on('delete', (data) => {
    try {
      const id = LogootID.fromJSON(data.id);
      console.log(`[CRDT] delete id=${JSON.stringify(data.id)}`);
      crdtDocument.delete(id);

      // Relay to everyone else in /crdt
      socket.broadcast.emit('delete', { id: data.id });
    } catch (err) {
      console.error('[CRDT] Error handling delete:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[CRDT] Client disconnected: ${clientId}`);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     OT & CRDT Collaborative Editor Demo              ║');
  console.log('║              (Socket.IO Edition)                     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Server running on http://localhost:${PORT}             ║`);
  console.log('║                                                      ║');
  console.log(`║  OT  Demo  → http://localhost:${PORT}/ot               ║`);
  console.log(`║  CRDT Demo → http://localhost:${PORT}/crdt             ║`);
  console.log('║                                                      ║');
  console.log('║  Open each URL in multiple browser tabs to test!     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

