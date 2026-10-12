const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeId(size = 10) {
  return crypto.randomBytes(size).toString('hex');
}

function makeRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(client, message) {
  const socket = client && (client.socket || client);
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  room.clients.forEach((client) => send(client, message));
}

function roomInfo(room) {
  return {
    code: room.code,
    connected: room.clients.size,
    seats: Array.from(room.clients.values()).map((client) => ({ seat: client.seat, name: client.name })),
  };
}

function announceRoom(room) {
  broadcast(room, { type: 'roster', ...roomInfo(room), hostConnected: Boolean(room.hostId) });
}

function leaveRoom(client) {
  const room = client.roomCode ? rooms.get(client.roomCode) : null;
  if (!room) return;
  room.clients.delete(client.id);
  if (room.hostId === client.id) {
    const nextHost = room.clients.values().next().value;
    room.hostId = nextHost ? nextHost.id : null;
    if (nextHost) {
      nextHost.role = 'host';
      send(nextHost, { type: 'role', role: 'host', snapshot: room.snapshot, event: room.event });
    }
  }
  client.roomCode = null;
  client.seat = null;
  if (room.clients.size === 0) rooms.delete(room.code);
  else announceRoom(room);
}

function joinRoom(client, code, name) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) return send(client, { type: 'error', message: '房间不存在，请检查房间码。' });
  if (room.clients.size >= 2) return send(client, { type: 'error', message: '房间已满，最多两位玩家。' });
  const usedSeats = new Set(Array.from(room.clients.values()).map((item) => item.seat));
  const seat = usedSeats.has(0) ? 1 : 0;
  client.roomCode = room.code;
  client.seat = seat;
  client.name = String(name || `玩家 ${seat + 1}`).slice(0, 20);
  client.role = 'guest';
  room.clients.set(client.id, client);
  send(client, { type: 'room', code: room.code, seat, role: client.role, snapshot: room.snapshot, event: room.event });
  announceRoom(room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  let requested = url.pathname === '/' ? 'wechat-game-online.html' : url.pathname.slice(1);
  requested = decodeURIComponent(requested);
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocketServer({ server });
wss.on('connection', (socket) => {
  const client = { id: makeId(), socket, readyState: 1, roomCode: null, seat: null, role: 'offline', name: '' };
  client.readyState = socket.readyState;
  const sendClient = (message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };
  sendClient({ type: 'hello', clientId: client.id });

  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return sendClient({ type: 'error', message: '消息格式无效。' }); }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'create') {
      leaveRoom(client);
      const room = { code: makeRoomCode(), hostId: client.id, clients: new Map(), snapshot: null, event: null };
      rooms.set(room.code, room);
      client.roomCode = room.code;
      client.seat = 0;
      client.role = 'host';
      client.name = String(message.name || '玩家 1').slice(0, 20);
      room.clients.set(client.id, client);
      return sendClient({ type: 'room', code: room.code, seat: 0, role: 'host', snapshot: null, event: null });
    }

    if (message.type === 'join') return joinRoom(client, message.code, message.name);

    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room) return sendClient({ type: 'error', message: '请先创建或加入房间。' });

    if (message.type === 'state') {
      if (room.hostId !== client.id) return sendClient({ type: 'error', message: '只有房主可以同步游戏状态。' });
      room.snapshot = message.snapshot || null;
      room.event = message.event || null;
      broadcast(room, { type: 'state', snapshot: room.snapshot, event: room.event, from: client.id });
      return;
    }

    if (message.type === 'intent') {
      const host = room.clients.get(room.hostId);
      if (!host) return sendClient({ type: 'error', message: '房主已离线，暂时无法操作。' });
      send(host, { type: 'intent', action: message.action, payload: message.payload || {}, fromSeat: client.seat, requestId: message.requestId || makeId(4) });
      return;
    }

    if (message.type === 'leave') leaveRoom(client);
  });

  socket.on('close', () => leaveRoom(client));
  socket.on('error', () => leaveRoom(client));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Forest Mystery online server listening on port ${PORT}`);
});
