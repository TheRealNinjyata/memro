let socket, canvas, ctx, squares, playerId, myTurn, gameOver, lastTapTime, roomId, tapCount, gameState;
const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ffa500', '#800080', '#008000'];
const tones = Array(9).fill().map((_, i) => new Audio(`/audio/tone${i}.wav`));
let lobby, waitingRoom, gameContainer, gameNameInput, createGameBtn, howToPlayBtn,
    howToPlayPopup, closeHowToPlayBtn, openGamesList, gameOverDiv, gameOverStatus,
    sequenceLengthText, playAgainBtn, exitBtn, rematchWaiting, matchStarted, statusText, timerText,
    rematchPopup, acceptRematchBtn, declineRematchBtn, inGameExitBtn, waitingExitBtn, singlePlayerBtn;
let isBoardLocked = false;
let isSinglePlayer = false;
let computerSequence = [];
let playerSequence = [];

function initDOM() {
  lobby = document.getElementById('lobby');
  waitingRoom = document.getElementById('waiting-room');
  gameContainer = document.getElementById('game-container');
  gameNameInput = document.getElementById('game-name');
  createGameBtn = document.getElementById('create-game');
  howToPlayBtn = document.getElementById('how-to-play');
  howToPlayPopup = document.getElementById('how-to-play-popup');
  closeHowToPlayBtn = document.getElementById('close-how-to-play');
  openGamesList = document.getElementById('open-games');
  gameOverDiv = document.getElementById('game-over');
  gameOverStatus = document.getElementById('game-over-status');
  sequenceLengthText = document.getElementById('sequence-length');
  playAgainBtn = document.getElementById('play-again');
  exitBtn = document.getElementById('exit');
  rematchWaiting = document.getElementById('rematch-waiting');
  matchStarted = document.getElementById('match-started');
  rematchPopup = document.getElementById('rematch-popup');
  acceptRematchBtn = document.getElementById('accept-rematch');
  declineRematchBtn = document.getElementById('decline-rematch');
  inGameExitBtn = document.getElementById('in-game-exit');
  waitingExitBtn = document.getElementById('waiting-exit');
  singlePlayerBtn = document.getElementById('single-player');
  statusText = document.getElementById('status');
  timerText = document.getElementById('timer');
  canvas = document.getElementById('game-canvas');
  ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;

  if (!canvas || !ctx || !createGameBtn || !statusText || !timerText || !inGameExitBtn || !waitingExitBtn || !singlePlayerBtn) {
    console.error('Missing critical DOM elements:', {
      canvas: !!canvas,
      ctx: !!ctx,
      createGameBtn: !!createGameBtn,
      statusText: !!statusText,
      timerText: !!timerText,
      inGameExitBtn: !!inGameExitBtn,
      waitingExitBtn: !!waitingExitBtn,
      singlePlayerBtn: !!singlePlayerBtn
    });
    alert('Game initialization failed');
    return false;
  }
  return true;
}

function initCanvas() {
  canvas.width = 500;
  canvas.height = 500;
  canvas.style.display = 'block';
  squares = [];
  const gridSize = 500 / 3;
  const padding = 5;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      squares.push({ x: col * gridSize + padding, y: row * gridSize + padding, width: gridSize - 2 * padding, height: gridSize - 2 * padding, index: i });
    }
  }
  drawCanvas();
  canvas.removeEventListener('click', handleClick);
  canvas.removeEventListener('touchstart', handleClick);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('touchstart', handleClick, { passive: false });
}

function drawCanvas() {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  squares.forEach(square => {
    ctx.fillStyle = colors[square.index];
    ctx.fillRect(square.x, square.y, square.width, square.height);
  });
}

function grayOutBoard() {
  ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function clearGrayOut() {
  drawCanvas();
}

function highlightSquare(index) {
  const square = squares[index];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(square.x, square.y, square.width, square.height);
  setTimeout(() => {
    drawCanvas(); // Always redraw to ensure highlights clear
  }, 500);
}

function handleClick(event) {
  event.preventDefault();
  if (!myTurn || gameOver || isBoardLocked) {
    console.log(`Click ignored: myTurn=${myTurn}, gameOver=${gameOver}, isBoardLocked=${isBoardLocked}`);
    return;
  }
  isBoardLocked = true;
  if (!isSinglePlayer) grayOutBoard(); // Only gray out in multiplayer
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.type === 'touchstart' ? event.touches[0].clientX : event.clientX) - rect.left;
  const y = (event.type === 'touchstart' ? event.touches[0].clientY : event.clientY) - rect.top;
  const canvasX = x * scaleX;
  const canvasY = y * scaleY;
  console.log(`Input event: type=${event.type}, clientX=${event.type === 'touchstart' ? event.touches[0].clientX : event.clientX}, clientY=${event.type === 'touchstart' ? event.touches[0].clientY : event.clientY}, rect.left=${rect.left}, rect.top=${rect.top}, rect.width=${rect.width}, scaleX=${scaleX.toFixed(2)}, canvasX=${canvasX.toFixed(2)}, canvasY=${canvasY.toFixed(2)}`);
  const square = squares.find(s => canvasX >= s.x && canvasX <= s.x + s.width && canvasY >= s.y && canvasY <= s.y + s.height);
  if (square) {
    console.log(`Detected tap on square ${square.index}: x=${square.x}-${square.x + square.width}, y=${square.y}-${square.y + square.height}`);
    handleTap(square.index);
  } else {
    console.log(`No square detected for canvas coordinates: x=${canvasX.toFixed(2)}, y=${canvasY.toFixed(2)}`);
    isBoardLocked = false;
    if (!isSinglePlayer) clearGrayOut();
  }
}

function handleTap(squareId) {
  if (isSinglePlayer) {
    playerSequence.push(squareId);
    lastTapTime = Date.now();
    tapCount++;
    highlightSquare(squareId);
    if (tones[squareId]) tones[squareId].play().catch(e => console.error('Audio play error:', e));
    // Validate sequence
    if (playerSequence.length <= computerSequence.length) {
      if (playerSequence[playerSequence.length - 1] !== computerSequence[playerSequence.length - 1]) {
        console.log(`Incorrect tap: expected ${computerSequence[playerSequence.length - 1]}, got ${squareId}`);
        endSinglePlayerGame();
        return;
      }
      if (playerSequence.length === computerSequence.length) {
        console.log('Correctly repeated sequence');
      }
    }
    if (playerSequence.length === computerSequence.length + 1) {
      computerSequence.push(squareId);
      playerSequence = [];
      myTurn = false;
      statusText.textContent = "Computer's Turn";
      setTimeout(computerTurn, 1000);
    } else {
      isBoardLocked = false;
    }
  } else {
    socket.emit('tap', { squareId, roomId });
    lastTapTime = Date.now();
    tapCount++;
    highlightSquare(squareId);
    if (tones[squareId]) tones[squareId].play().catch(e => console.error('Audio play error:', e));
    setTimeout(() => {
      isBoardLocked = false;
      clearGrayOut();
    }, 500);
  }
}

function computerTurn() {
  let i = 0;
  function playNext() {
    if (i < computerSequence.length) {
      const squareId = computerSequence[i];
      highlightSquare(squareId);
      if (tones[squareId]) tones[squareId].play().catch(e => console.error('Audio play error:', e));
      i++;
      setTimeout(playNext, 1000);
    } else {
      // Computer adds a random square
      const randomSquare = Math.floor(Math.random() * 9);
      computerSequence.push(randomSquare);
      highlightSquare(randomSquare);
      if (tones[randomSquare]) tones[randomSquare].play().catch(e => console.error('Audio play error:', e));
      setTimeout(() => {
        myTurn = true;
        statusText.textContent = 'Your Turn';
        lastTapTime = Date.now();
        tapCount = 0;
        playerSequence = [];
        isBoardLocked = false;
      }, 500);
    }
  }
  playNext();
}

function endSinglePlayerGame() {
  gameOver = true;
  gameState = 'ended';
  const score = computerSequence.length;
  const highScore = parseInt(localStorage.getItem('memroHighScore') || '0', 10);
  if (score > highScore) {
    localStorage.setItem('memroHighScore', score);
  }
  statusText.textContent = 'Game Over';
  gameOverStatus.textContent = 'Game Over';
  sequenceLengthText.textContent = `Score: ${score} | High Score: ${Math.max(score, highScore)}`;
  gameOverDiv.style.display = 'block';
  playAgainBtn.textContent = 'Play Again';
  rematchPopup.style.display = 'none';
}

function startSinglePlayerGame() {
  cleanupGame();
  isSinglePlayer = true;
  gameState = 'playing';
  myTurn = true;
  gameOver = false;
  lastTapTime = Date.now();
  tapCount = 0;
  computerSequence = [];
  playerSequence = [];
  lobby.style.display = 'none';
  waitingRoom.style.display = 'none';
  gameContainer.style.display = 'block';
  canvas.style.display = 'block';
  statusText.textContent = 'Your Turn';
  timerText.textContent = 'Time: 10';
  gameOverDiv.style.display = 'none';
  rematchPopup.style.display = 'none';
  initCanvas();
  matchStarted.style.display = 'block';
  setTimeout(() => { matchStarted.style.display = 'none'; }, 1000);
}

function resetUI() {
  lobby.style.display = 'block';
  waitingRoom.style.display = 'none';
  gameContainer.style.display = 'none';
  gameOverDiv.style.display = 'none';
  rematchWaiting.style.display = 'none';
  matchStarted.style.display = 'none';
  howToPlayPopup.style.display = 'none';
  rematchPopup.style.display = 'none';
  statusText.textContent = 'Waiting...';
  timerText.textContent = '';
  sequenceLengthText.textContent = '';
  gameOverStatus.textContent = '';
  canvas.style.display = 'none';
  gameState = 'lobby';
}

function cleanupGame() {
  myTurn = false;
  gameOver = false;
  lastTapTime = null;
  tapCount = 0;
  roomId = null;
  playerId = null;
  isBoardLocked = false;
  isSinglePlayer = false;
  computerSequence = [];
  playerSequence = [];
  canvas.style.display = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.removeEventListener('click', handleClick);
  canvas.removeEventListener('touchstart', handleClick);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!initDOM()) return;
  resetUI();
  socket = io('https://memro.onrender.com/', { reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });

  socket.on('connect', () => {
    console.log(`Connected: ${socket.id}`);
    socket.emit('get_lobby');
    setTimeout(() => {
      if (openGamesList.children.length === 0) {
        console.log('No games in lobby, retrying get_lobby');
        socket.emit('get_lobby');
      }
    }, 2000);
  });

  socket.on('reconnect_error', () => {
    console.error('Reconnection failed');
    alert('Lost connection to server');
    resetUI();
    cleanupGame();
  });

  socket.on('game_created', (data) => {
    console.log(`Game created: roomId=${data.roomId}`);
    roomId = data.roomId;
    lobby.style.display = 'none';
    waitingRoom.style.display = 'flex';
    gameState = 'waiting';
  });

  socket.on('update_lobby', (games) => {
    console.log('Received lobby update:', JSON.stringify(games, null, 2));
    openGamesList.innerHTML = '';
    games.forEach(game => {
      if (!game.roomId || !game.name) {
        console.error('Invalid game data:', game);
        return;
      }
      const li = document.createElement('li');
      li.textContent = game.name;
      const joinBtn = document.createElement('button');
      joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', () => {
        console.log('Attempting to join:', game.roomId);
        socket.emit('join_game', { roomId: game.roomId });
      });
      li.appendChild(joinBtn);
      openGamesList.appendChild(li);
    });
  });

  socket.on('game_started', (data) => {
    console.log(`Game started: playerId=${data.playerId}, isFirst=${data.isFirst}, roomId=${data.roomId}`);
    playerId = data.playerId;
    myTurn = data.isFirst;
    gameOver = false;
    lastTapTime = Date.now();
    tapCount = 0;
    roomId = data.roomId;
    lobby.style.display = 'none';
    waitingRoom.style.display = 'none';
    gameContainer.style.display = 'block';
    gameOverDiv.style.display = 'none';
    rematchWaiting.style.display = 'none';
    rematchPopup.style.display = 'none';
    matchStarted.style.display = 'block';
    canvas.style.display = 'block';
    statusText.textContent = myTurn ? 'Your Turn' : "Opponent's Turn";
    gameState = 'playing';
    initCanvas();
    setTimeout(() => matchStarted.style.display = 'none', 1000);
  });

  socket.on('tap', (data) => {
    console.log(`Received tap: squareId=${data.squareId}`);
    isBoardLocked = true;
    grayOutBoard();
    highlightSquare(data.squareId);
    if (tones[data.squareId]) {
      console.log(`Playing tone for squareId=${data.squareId}`);
      tones[data.squareId].play().catch(e => console.error('Audio play error:', e));
    }
    setTimeout(() => {
      isBoardLocked = false;
      clearGrayOut();
    }, 500);
  });

  socket.on('turn', (data) => {
    myTurn = data.currentPlayer === playerId;
    console.log(`Turn update: currentPlayer=${data.currentPlayer}, myTurn=${myTurn}, playerId=${playerId}`);
    statusText.textContent = myTurn ? 'Your Turn' : "Opponent's Turn";
    lastTapTime = Date.now();
    tapCount = 0;
  });

  socket.on('win', (data) => {
    gameOver = true;
    gameState = 'ended';
    console.log(`Win: sequenceLength=${data.sequenceLength}`);
    statusText.textContent = 'You Win!';
    gameOverStatus.textContent = 'You Win!';
    sequenceLengthText.textContent = `Sequence Length: ${data.sequenceLength}`;
    gameOverDiv.style.display = 'block';
  });

  socket.on('lose', (data) => {
    gameOver = true;
    gameState = 'ended';
    console.log(`Lose: sequenceLength=${data.sequenceLength}`);
    statusText.textContent = 'You Lose!';
    gameOverStatus.textContent = 'You Lose!';
    sequenceLengthText.textContent = `Sequence Length: ${data.sequenceLength}`;
    gameOverDiv.style.display = 'block';
  });

  socket.on('opponentDisconnected', () => {
    if (gameState === 'playing') {
      gameOver = true;
      gameState = 'ended';
      console.log('Opponent disconnected during active game');
      statusText.textContent = 'Opponent Disconnected';
      gameOverStatus.textContent = 'Opponent Disconnected';
      sequenceLengthText.textContent = '';
      gameOverDiv.style.display = 'block';
    } else {
      console.log('Opponent disconnected, but game not active, ignoring');
    }
  });

  socket.on('exit_confirmed', (data) => {
    console.log(`Exit confirmed: ${data.message}`);
    resetUI();
    cleanupGame();
    socket.emit('get_lobby');
  });

  socket.on('rematch_offer', () => {
    console.log('Received rematch offer');
    rematchPopup.style.display = 'block';
  });

  socket.on('rematch_waiting', () => {
    console.log('Waiting for rematch');
    rematchWaiting.style.display = 'block';
  });

  socket.on('rematch_declined', () => {
    console.log('Rematch declined');
    alert('Rematch declined');
    rematchWaiting.style.display = 'none';
    setTimeout(() => {
      resetUI();
      cleanupGame();
    }, 1000);
  });

  socket.on('error', (data) => {
    console.error('Error:', data.message);
    alert(data.message);
    if (data.message === 'Not your turn') return;
    resetUI();
    cleanupGame();
  });

  createGameBtn.addEventListener('click', () => {
    const name = gameNameInput.value.trim();
    if (!name) return alert('Please enter a game name');
    socket.emit('create_game', { name });
    gameNameInput.value = '';
  });

  singlePlayerBtn.addEventListener('click', startSinglePlayerGame);

  howToPlayBtn.addEventListener('click', () => howToPlayPopup.style.display = 'block');
  closeHowToPlayBtn.addEventListener('click', () => howToPlayPopup.style.display = 'none');

  playAgainBtn.addEventListener('click', () => {
    if (isSinglePlayer) {
      startSinglePlayerGame();
    } else {
      socket.emit('rematch_request', { roomId });
      gameOverDiv.style.display = 'none';
      rematchWaiting.style.display = 'block';
    }
  });

  exitBtn.addEventListener('click', () => {
    if (isSinglePlayer) {
      resetUI();
      cleanupGame();
    } else {
      socket.emit('exit_game', { roomId });
      resetUI();
      cleanupGame();
    }
  });

  acceptRematchBtn.addEventListener('click', () => {
    socket.emit('accept_rematch', { roomId });
    rematchPopup.style.display = 'none';
  });

  declineRematchBtn.addEventListener('click', () => {
    socket.emit('decline_rematch', { roomId });
    rematchPopup.style.display = 'none';
    setTimeout(() => {
      resetUI();
      cleanupGame();
    }, 1000);
  });

  inGameExitBtn.addEventListener('click', () => {
    if (isSinglePlayer) {
      resetUI();
      cleanupGame();
    } else {
      socket.emit('exit_game', { roomId });
      resetUI();
      cleanupGame();
    }
  });

  waitingExitBtn.addEventListener('click', () => {
    socket.emit('exit_game', { roomId });
    resetUI();
    cleanupGame();
  });

  setInterval(() => {
    if (myTurn && !gameOver && lastTapTime) {
      const remaining = 10 - (Date.now() - lastTapTime) / 1000;
      timerText.textContent = `Time: ${Math.max(0, Math.floor(remaining))}`;
      if (remaining <= 0) {
        console.log('Client detected timeout');
        if (isSinglePlayer) {
          endSinglePlayerGame();
        } else {
          socket.emit('timeout', { roomId });
        }
      }
    } else {
      timerText.textContent = '';
    }
  }, 100);
});
