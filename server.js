const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const rooms = new Map();
const COLORS = ['#ff6f61', '#3d8bff', '#34b88a', '#f2aa3b', '#a477e8', '#ed5d9a', '#29a9b5', '#849342'];
const SPECIALS = [
  ...Array(3).fill('boost6'), ...Array(3).fill('back6'),
  ...Array(3).fill('pullLeader'), ...Array(3).fill('pullChaser'),
  ...Array(3).fill('skip'), ...Array(2).fill('swap'),
  ...Array(3).fill('ahead3'), ...Array(3).fill('back3')
];
const LABELS = {
  boost6: 'SNEAK AHEAD', back6: 'TRIP UP', pullLeader: 'YANK BACK',
  pullChaser: 'DRAG ALONG', skip: 'LOSE A TURN', swap: 'SWAP SPOTS',
  ahead3: 'SHORTCUT +3', back3: 'DETOUR −3', reset: 'BACK TO ZERO', everyoneBack: 'GROUP GROAN −3'
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
function publicRoom(room) {
  return { code: room.code, phase: room.phase, players: room.players.map(p => ({ id: p.id, name: p.name, position: p.position, color: p.color, skipTurns: p.skipTurns })), turnIndex: room.turnIndex, currentTurn: room.phase === 'playing' ? room.players[room.turnIndex]?.id : null, winner: room.winner, pending: room.pending || null, lastRoll: room.lastRoll, log: room.log.slice(-12), board: room.board, lastEvent: room.lastEvent, createdAt: room.createdAt };
}
function say(room, text) { room.lastEvent = text; room.log.push({ text, at: Date.now(), kind: 'system' }); room.log = room.log.slice(-30); }
function nextTurn(room) {
  for (let i = 0; i < room.players.length; i++) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const p = room.players[room.turnIndex];
    if (p.skipTurns > 0) { p.skipTurns--; say(room, `${p.name} loses a turn. The track keeps laughing.`); continue; }
    return;
  }
}
function effects() {
  const bag = SPECIALS.slice();
  for (let i = bag.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  const places = Array.from({ length: 48 }, (_, i) => i + 1).filter(n => n !== 15 && n !== 25);
  for (let i = places.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [places[i], places[j]] = [places[j], places[i]]; }
  const board = {};
  board[15] = 'everyoneBack'; board[25] = 'reset';
  bag.forEach((effect, i) => board[places[i]] = effect);
  return board;
}
function roomCode() {
  let code;
  do { code = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(code));
  return code;
}
async function readBody(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
}
function fail(res, status, message) { json(res, status, { error: message }); }

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/create' && req.method === 'POST') {
      const { name } = await readBody(req); const clean = String(name || '').trim().slice(0, 18);
      if (!clean) return fail(res, 400, 'Pick a name first.');
      const code = roomCode(); const id = crypto.randomUUID();
      const room = { code, phase: 'lobby', players: [{ id, name: clean, position: 0, color: COLORS[0], skipTurns: 0 }], turnIndex: 0, winner: null, lastRoll: null, log: [], board: effects(), lastEvent: 'A fresh track. Try not to embarrass yourself.', createdAt: Date.now() };
      rooms.set(code, room); return json(res, 201, { ...publicRoom(room), playerId: id });
    }
    const match = url.pathname.match(/^\/api\/room\/([A-Z0-9]+)(?:\/(join|start|roll|choice|chat))?$/i);
    if (match) {
      const code = match[1].toUpperCase(); const action = match[2]; const room = rooms.get(code);
      if (!room) return fail(res, 404, 'That room code has vanished. Check it and try again.');
      if (req.method === 'GET' && !action) return json(res, 200, publicRoom(room));
      if (req.method !== 'POST') return fail(res, 405, 'That move is not allowed.');
      const body = await readBody(req);
      if (action === 'chat') {
        const player = room.players.find(p => p.id === body.playerId);
        const message = String(body.message || '').trim().slice(0, 160);
        if (!player) return fail(res, 403, 'Join the room before posting.');
        if (!message) return fail(res, 400, 'Type a message first.');
        room.log.push({ text: message, name: player.name, playerId: player.id, color: player.color, at: Date.now(), kind: 'chat' });
        room.log = room.log.slice(-30);
        return json(res, 200, publicRoom(room));
      }
      if (action === 'join') {
        const name = String(body.name || '').trim().slice(0, 18);
        if (!name) return fail(res, 400, 'Pick a name first.');
        if (room.phase !== 'lobby') return fail(res, 409, 'This race has already started.');
        if (room.players.length >= 8) return fail(res, 409, 'Room is full. Eight racers is plenty of chaos.');
        const id = crypto.randomUUID(); room.players.push({ id, name, position: 0, color: COLORS[room.players.length], skipTurns: 0 });
        say(room, `${name} joined the race. Confidence: suspiciously high.`);
        return json(res, 201, { ...publicRoom(room), playerId: id });
      }
      if (action === 'start') {
        if (room.phase !== 'lobby') return fail(res, 409, 'The race is already rolling.');
        if (body.playerId !== room.players[0].id) return fail(res, 403, 'Only the room host can start the race.');
        if (room.players.length < 2) return fail(res, 409, 'Get at least two racers before starting. Unless you enjoy losing to yourself.');
        room.phase = 'playing'; room.turnIndex = crypto.randomInt(room.players.length); say(room, 'The race is on. The mascot has placed bets against all of you.');
        return json(res, 200, publicRoom(room));
      }
      if (action === 'roll') {
        if (room.phase !== 'playing') return fail(res, 409, 'The race has not started.');
        const player = room.players.find(p => p.id === body.playerId);
        if (!player || room.players[room.turnIndex].id !== player.id) return fail(res, 403, 'Not your turn. The mascot says wait your turn, champ.');
        const roll = crypto.randomInt(1, 7); room.lastRoll = { playerId: player.id, value: roll, at: Date.now() };
        const target = player.position + roll;
        if (target > 50) { say(room, `${player.name} rolled ${roll} and overshot 50. A beautiful waste of effort.`); nextTurn(room); }
        else {
          player.position = target;
          if (target === 50) { room.phase = 'finished'; room.winner = player.id; say(room, `${player.name} wins! Everyone else was just there for the scenery.`); }
          else {
            const effect = room.board[target];
            if (!effect) { say(room, `${player.name} rolled ${roll} and landed on ${target}. Miraculously, nothing happened.`); nextTurn(room); }
            else {
              room.pending = { playerId: player.id, effect, from: target };
              say(room, `${player.name} hit ${LABELS[effect]}. The mascot looks delighted.`);
              if (effect === 'skip') { player.skipTurns++; room.pending = null; say(room, `${player.name} will lose their next turn. Take a breather, loser.`); nextTurn(room); }
              else if (effect === 'reset') { player.position = 0; room.pending = null; say(room, `${player.name} got sent back to zero. That's rough. Mostly for them.`); nextTurn(room); }
              else if (effect === 'everyoneBack') { room.players.filter(p => p.id !== player.id).forEach(p => p.position = Math.max(0, p.position - 3)); room.pending = null; say(room, `${player.name} stays put; everyone else stumbles back three.`); nextTurn(room); }
              else if (effect === 'ahead3') { player.position = Math.min(50, player.position + 3); room.pending = null; if (player.position === 50) { room.phase='finished'; room.winner=player.id; say(room, `${player.name} steals the win with a shortcut! Annoyingly impressive.`); } else nextTurn(room); }
              else if (effect === 'back3' || effect === 'back6') { player.position = Math.max(0, player.position - (effect === 'back3' ? 3 : 6)); room.pending = null; nextTurn(room); }
              else if (effect === 'boost6') { /* choice follows */ }
              else if (effect === 'swap' && room.players.length === 1) { room.pending = null; nextTurn(room); }
              else if (effect === 'pullLeader' && !room.players.some(p => p.position > player.position)) { room.pending = null; say(room, 'Nobody is ahead. Even the special square gave up on this one.'); nextTurn(room); }
              else if (effect === 'pullChaser' && !room.players.some(p => p.position < player.position)) { room.pending = null; say(room, 'Nobody is behind. Enjoy the rare view from the front.'); nextTurn(room); }
              else if (effect === 'pullLeader' && room.players.filter(p => p.position > player.position).length === 1) { const targetPlayer = room.players.find(p => p.position > player.position); targetPlayer.position = player.position; room.pending = null; say(room, `${player.name} yanks ${targetPlayer.name} back to ${player.position}. Ouch.`); nextTurn(room); }
              else if (effect === 'pullChaser' && room.players.filter(p => p.position < player.position).length === 1) { const targetPlayer = room.players.find(p => p.position < player.position); targetPlayer.position = player.position; room.pending = null; say(room, `${player.name} drags ${targetPlayer.name} up to ${player.position}. No personal space here.`); nextTurn(room); }
            }
          }
        }
        return json(res, 200, publicRoom(room));
      }
      if (action === 'choice') {
        const pending = room.pending; const player = room.players.find(p => p.id === body.playerId);
        if (!pending || pending.playerId !== body.playerId || !player || room.players[room.turnIndex]?.id !== player.id) return fail(res, 403, 'There is no choice waiting for you.');
        if (pending.effect === 'boost6') {
          const steps = Number(body.steps); if (!Number.isInteger(steps) || steps < 1 || steps > 6) return fail(res, 400, 'Choose between 1 and 6 spaces.');
          player.position = Math.min(50, player.position + steps);
          say(room, `${player.name} chose a ${steps}-space boost. ${steps === 6 ? 'A whole six. Greedy.' : 'Playing it safe, huh?'}`);
        } else {
          const target = room.players.find(p => p.id === body.targetId && p.id !== player.id);
          if (!target) return fail(res, 400, 'Choose another racer. You cannot bully yourself.');
          if (pending.effect === 'swap') { [player.position, target.position] = [target.position, player.position]; say(room, `${player.name} swaps places with ${target.name}. Friendship over.`); }
          else if (pending.effect === 'pullLeader') { if (target.position <= player.position) return fail(res, 400, 'Pick someone ahead of you.'); target.position = player.position; say(room, `${player.name} yanks ${target.name} back to ${player.position}. Ouch.`); }
          else if (pending.effect === 'pullChaser') { if (target.position >= player.position) return fail(res, 400, 'Pick someone behind you.'); target.position = player.position; say(room, `${player.name} drags ${target.name} up to ${player.position}. No personal space here.`); }
        }
        room.pending = null;
        if (player.position === 50) { room.phase = 'finished'; room.winner = player.id; say(room, `${player.name} wins! Must be nice.`); }
        else nextTurn(room);
        return json(res, 200, publicRoom(room));
      }
      return fail(res, 404, 'Unknown action.');
    }
    if (url.pathname.startsWith('/api/')) return fail(res, 404, 'Not found.');
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const full = path.resolve(ROOT, file);
    if (!full.startsWith(ROOT + path.sep)) return fail(res, 403, 'Forbidden');
    fs.readFile(full, (err, data) => {
      if (err) return fail(res, 404, 'Not found.');
      const ext = path.extname(full); const type = ext === '.html' ? 'text/html' : ext === '.svg' ? 'image/svg+xml' : 'text/plain';
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' }); res.end(data);
    });
  } catch (error) { fail(res, 400, error instanceof SyntaxError ? 'That request was garbled.' : 'Something went wrong. Try again.'); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Catch Me If You Can is ready at http://localhost:${PORT}`));
