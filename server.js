const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));

const games = {};
const players = {};
const timers = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  players[socket.id] = { game: null };

  socket.on('create_game', (data) => {
    if (!data.name || typeof data.name !== 'string') {
      socket.emit('error', { message: 'Invalid game name' });
      return;
    }
    const roomId = `game-${socket.id}-${Date.now()}`;
    console.log(`Creating game: ${roomId} (${data.name})`);
    games[roomId] = {
      roomId,
      name: data.name,
      creator: socket.id,
      joiner: null,
      state: 'waiting',
      sequence: [],
      tapsThisTurn: [],
      currentPlayer: null,
      lastFirstPlayer: null,
      lastTapTime: null,
    };
    players[socket.id].game = roomId;
    socket.join(roomId);
    socket.emit('game_created', { roomId, name: data.name });
    console.log('Games state:', Object.values(games).map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
    io.emit('update_lobby', Object.values(games)
      .filter(g => g.state === 'waiting')
      .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
  });

  socket.on('join_game', (data) => {
    if (!data.roomId || typeof data.roomId !== 'string') {
      console.log(`Invalid join attempt: roomId=${data.roomId}, socketId=${socket.id}`);
      socket.emit('error', { message: 'Invalid game ID' });
      return;
    }
    const game = games[data.roomId];
    console.log(`Join attempt: roomId=${data.roomId}, gameExists=${!!game}, state=${game?.state}, creator=${game?.creator}, socketId=${socket.id}`);
    if (game && game.state === 'waiting' && game.creator !== socket.id) {
      console.log(`Player ${socket.id} joining game: ${data.roomId}`);
      game.joiner = socket.id;
      game.state = 'playing';
      players[socket.id].game = data.roomId;
      socket.join(data.roomId);
      const firstPlayer = Math.random() < 0.5 ? game.creator : game.joiner;
      game.currentPlayer = firstPlayer;
      game.lastFirstPlayer = firstPlayer;
      game.lastTapTime = Date.now();
      io.to(game.creator).emit('game_started', { playerId: game.creator, isFirst: game.creator === firstPlayer, roomId: data.roomId });
      io.to(game.joiner).emit('game_started', { playerId: game.joiner, isFirst: game.joiner === firstPlayer, roomId: data.roomId });
      timers[data.roomId] = setInterval(() => checkTimeout(data.roomId), 1000);
      console.log('Games state after join:', Object.values(games).map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
      io.emit('update_lobby', Object.values(games)
        .filter(g => g.state === 'waiting')
        .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
    } else {
      socket.emit('error', { message: 'Cannot join this game' });
    }
  });

  function checkTimeout(roomId) {
    const game = games[roomId];
    if (!game || game.state !== 'playing') return;
    const timeSinceLastTap = Date.now() - game.lastTapTime;
    if (timeSinceLastTap > 10000) {
      console.log(`Timeout for ${game.currentPlayer} in ${roomId}`);
      io.to(game.currentPlayer).emit('lose', { sequenceLength: game.sequence.length });
      const opponent = game.creator === game.currentPlayer ? game.joiner : game.creator;
      io.to(opponent).emit('win', { sequenceLength: game.sequence.length });
      game.state = 'ended';
      clearInterval(timers[roomId]);
      delete timers[roomId];
    }
  }

  socket.on('tap', (data) => {
    const game = games[data.roomId];
    if (!game || game.state !== 'playing') {
      console.log(`Invalid tap: socketId=${socket.id}, roomId=${data.roomId}, gameExists=${!!game}, state=${game?.state}`);
      socket.emit('error', { message: 'Game not active' });
      return;
    }
    if (game.currentPlayer !== socket.id) {
      console.log(`Invalid tap: socketId=${socket.id} is not currentPlayer=${game.currentPlayer}`);
      socket.emit('error', { message: 'Not your turn' });
      return;
    }
    if (game.tapsThisTurn.length > game.sequence.length) {
      console.log(`Invalid tap: socketId=${socket.id}, too many taps, tapsThisTurn=${game.tapsThisTurn.length}, sequenceLength=${game.sequence.length}`);
      socket.emit('error', { message: 'Too many taps in this turn' });
      return;
    }
    if (players[socket.id].game !== data.roomId) {
      console.log(`Invalid tap: socketId=${socket.id}, player.game=${players[socket.id].game}, sent roomId=${data.roomId}`);
      socket.emit('error', { message: 'Invalid game room' });
      return;
    }
    console.log(`Tap ${data.squareId} from ${socket.id} in ${data.roomId}, sequence=${JSON.stringify(game.sequence)}, tapsThisTurn=${JSON.stringify(game.tapsThisTurn)}`);
    game.tapsThisTurn.push(data.squareId);
    game.lastTapTime = Date.now();
    io.to(data.roomId).emit('tap', { squareId: data.squareId });

    // Validate sequence repetition
    if (game.tapsThisTurn.length <= game.sequence.length && game.sequence.length > 0) {
      if (game.tapsThisTurn[game.tapsThisTurn.length - 1] !== game.sequence[game.tapsThisTurn.length - 1]) {
        console.log(`Incorrect tap by ${socket.id}: expected ${game.sequence[game.tapsThisTurn.length - 1]}, got ${game.tapsThisTurn[game.tapsThisTurn.length - 1]}`);
        io.to(socket.id).emit('lose', { sequenceLength: game.sequence.length });
        const opponent = game.creator === socket.id ? game.joiner : game.creator;
        io.to(opponent).emit('win', { sequenceLength: game.sequence.length });
        game.state = 'ended';
        clearInterval(timers[data.roomId]);
        delete timers[data.roomId];
        return;
      }
      if (game.tapsThisTurn.length === game.sequence.length) {
        console.log(`Player ${socket.id} correctly repeated sequence: ${JSON.stringify(game.sequence)}`);
      }
    }

    // Advance turn
    if (game.tapsThisTurn.length === game.sequence.length + 1) {
      game.sequence.push(game.tapsThisTurn[game.tapsThisTurn.length - 1]);
      console.log(`Sequence updated: ${JSON.stringify(game.sequence)}`);
      game.tapsThisTurn = [];
      game.currentPlayer = game.creator === socket.id ? game.joiner : game.creator;
      game.lastTapTime = Date.now();
      console.log(`Turn changed to ${game.currentPlayer}`);
      io.to(game.creator).emit('turn', { currentPlayer: game.currentPlayer });
      io.to(game.joiner).emit('turn', { currentPlayer: game.currentPlayer });
    }
  });

  socket.on('timeout', (data) => {
    const game = games[data.roomId];
    if (!game || game.state !== 'playing' || game.currentPlayer !== socket.id) {
      console.log(`Invalid timeout: socketId=${socket.id}, roomId=${data.roomId}, state=${game?.state}, currentPlayer=${game?.currentPlayer}`);
      return;
    }
    console.log(`Timeout reported by ${socket.id} in ${data.roomId}`);
    io.to(socket.id).emit('lose', { sequenceLength: game.sequence.length });
    const opponent = game.creator === socket.id ? game.joiner : game.creator;
    io.to(opponent).emit('win', { sequenceLength: game.sequence.length });
    game.state = 'ended';
    clearInterval(timers[data.roomId]);
    delete timers[data.roomId];
  });

  socket.on('rematch_request', (data) => {
    const game = games[data.roomId];
    if (game && (game.creator === socket.id || game.joiner === socket.id) && game.state === 'ended') {
      console.log(`Rematch requested by ${socket.id} in ${data.roomId}`);
      game.rematchRequests = game.rematchRequests || {};
      game.rematchRequests[socket.id] = true;
      const opponent = game.creator === socket.id ? game.joiner : game.creator;
      io.to(opponent).emit('rematch_offer');
    }
  });

  socket.on('accept_rematch', (data) => {
    const game = games[data.roomId];
    if (game && (game.creator === socket.id || game.joiner === socket.id) && game.state === 'ended') {
      console.log(`Rematch accepted by ${socket.id} in ${data.roomId}`);
      game.rematchRequests = game.rematchRequests || {};
      game.rematchRequests[socket.id] = true;
      if (game.rematchRequests[game.creator] && game.rematchRequests[game.joiner]) {
        console.log(`Starting rematch in ${data.roomId}`);
        game.state = 'playing';
        game.sequence = [];
        game.tapsThisTurn = [];
        game.lastTapTime = Date.now();
        const firstPlayer = game.lastFirstPlayer === game.creator ? game.joiner : game.creator;
        game.currentPlayer = firstPlayer;
        game.lastFirstPlayer = firstPlayer;
        game.rematchRequests = {};
        io.to(game.creator).emit('game_started', { playerId: game.creator, isFirst: game.creator === firstPlayer, roomId: data.roomId });
        io.to(game.joiner).emit('game_started', { playerId: game.joiner, isFirst: game.joiner === firstPlayer, roomId: data.roomId });
        timers[data.roomId] = setInterval(() => checkTimeout(data.roomId), 1000);
      } else {
        io.to(socket.id).emit('rematch_waiting');
      }
    }
  });

  socket.on('decline_rematch', (data) => {
    const game = games[data.roomId];
    if (game && (game.creator === socket.id || game.joiner === socket.id)) {
      console.log(`Rematch declined by ${socket.id} in ${data.roomId}`);
      const opponent = game.creator === socket.id ? game.joiner : game.creator;
      io.to(opponent).emit('rematch_declined');
      socket.leave(data.roomId);
      delete games[data.roomId];
      players[socket.id].game = null;
      io.emit('update_lobby', Object.values(games)
        .filter(g => g.state === 'waiting')
        .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
    }
  });

  socket.on('exit_game', (data) => {
    const game = games[data.roomId];
    if (game && (game.creator === socket.id || game.joiner === socket.id)) {
      console.log(`Player ${socket.id} exiting game ${data.roomId}, state=${game.state}`);
      const opponent = game.creator === socket.id ? game.joiner : game.creator;
      if (game.state === 'playing' && opponent) {
        io.to(opponent).emit('win', { sequenceLength: game.sequence.length });
        io.to(opponent).emit('opponentDisconnected');
        players[opponent].game = null;
      }
      io.to(socket.id).emit('exit_confirmed', { message: 'You exited the game' });
      socket.leave(data.roomId);
      delete games[data.roomId];
      if (game.state === 'playing' && timers[data.roomId]) {
        clearInterval(timers[data.roomId]);
        delete timers[data.roomId];
      }
      players[socket.id].game = null;
      io.emit('update_lobby', Object.values(games)
        .filter(g => g.state === 'waiting')
        .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
    } else {
      socket.emit('exit_confirmed', { message: 'Game not found' });
    }
  });

  socket.on('get_lobby', () => {
    console.log(`Lobby requested by ${socket.id}`);
    socket.emit('update_lobby', Object.values(games)
      .filter(g => g.state === 'waiting')
      .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const gameId = players[socket.id].game;
    if (gameId && games[gameId] && games[gameId].state === 'playing') {
      const game = games[gameId];
      const opponent = game.creator === socket.id ? game.joiner : game.creator;
      if (opponent) {
        io.to(opponent).emit('win', { sequenceLength: game.sequence.length });
        io.to(opponent).emit('opponentDisconnected');
        players[opponent].game = null;
      }
      socket.leave(gameId);
      delete games[gameId];
      clearInterval(timers[gameId]);
      delete timers[gameId];
    }
    delete players[socket.id];
    io.emit('update_lobby', Object.values(games)
      .filter(g => g.state === 'waiting')
      .map(g => ({ roomId: g.roomId, name: g.name, state: g.state })));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});