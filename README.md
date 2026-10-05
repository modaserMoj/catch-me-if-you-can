# Catch Me If You Can

A real-time, turn-based party race for 2–8 players. The Node server uses only built-in modules; no package installation is needed.

## Run locally

1. Install Node.js 18 or newer.
2. From this folder, run `node server.js`.
3. Open `http://localhost:4173` to create a room.
4. For other devices on the same Wi-Fi, open `http://YOUR-COMPUTER-LAN-IP:4173` and enter the room code.

The server must remain running while the race is being played. Room state is held in memory, so restarting the server clears active rooms. For friends outside the same network, deploy this folder to a host that allows inbound HTTP traffic and share its public address; all players need to use the same server address. The app polls the server about once per second for live updates.

## Included

- Private five-character room codes and 2–8 player lobbies
- Shared, server-controlled dice rolls, turns, board positions, effects, and winner
- Live Trackside Gossip chat shared with everyone in the room
- Miff pops up with a fresh roast after every die roll
- 50-square serpentine board, with the reset fixed at square 25 and the group-back effect fixed at square 15
- All other special effects placed randomly when the room is created
- Original inline SVG mascot, Miff, with playful taunts

The app is an in-memory prototype; active games are not saved after a server restart.
