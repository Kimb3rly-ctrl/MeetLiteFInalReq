
const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    app: 'Meet Lite signaling server',
    status: 'ok',
    message: 'Server is running'
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    app: 'Meet Lite signaling server'
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

const rooms = new Map();
const RECONNECT_GRACE_PERIOD = 30000;

function generateRoomCode() {
  let code;

  do {
    code = crypto
      .randomBytes(4)
      .toString('hex')
      .substring(0, 6)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function getDisplayName(name) {
  return String(name || 'Guest')
    .trim()
    .slice(0, 28) || 'Guest';
}

function respond(callback, result) {
  if (typeof callback === 'function') {
    callback(result);
  }
}

async function createRoom(socket, data, callback) {
  try {
    if (socket.data.roomId) {
      return respond(callback, {
        ok: false,
        error: 'You are already in a meeting.'
      });
    }

    const roomId = generateRoomCode();
    const name = getDisplayName(data?.name);

    const room = new Map();

    room.set(socket.id, {
      name,
      disconnected: false,
      disconnectTimer: null
    });

    rooms.set(roomId, room);

    await socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;

    socket.emit('room-users', []);

    console.log('ROOM CREATED:', roomId);
    console.log('CREATOR:', name);

    respond(callback, {
      ok: true,
      roomId
    });

  } catch (error) {
    console.error('CREATE ROOM ERROR:', error);

    respond(callback, {
      ok: false,
      error: 'Server error while creating the meeting.'
    });
  }
}

async function joinRoom(socket, data, callback) {
  try {
    if (socket.data.roomId) {
      return respond(callback, {
        ok: false,
        error: 'You are already in a meeting.'
      });
    }

    const roomId = String(data?.roomId || '')
      .trim()
      .toUpperCase();

    if (!roomId) {
      return respond(callback, {
        ok: false,
        error: 'Please enter a meeting code.'
      });
    }

    const room = rooms.get(roomId);

    if (!room || room.size === 0) {
      return respond(callback, {
        ok: false,
        error: 'Meeting not found. Please check the meeting code.'
      });
    }

    const name = getDisplayName(data?.name);

    const existingUsers = [...room.entries()]
      .filter(([, user]) => !user.disconnected)
      .map(([id, user]) => ({
        id,
        name: user.name
      }));

    await socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;

    room.set(socket.id, {
      name,
      disconnected: false,
      disconnectTimer: null
    });

    socket.emit('room-users', existingUsers);

    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      name
    });

    console.log('USER JOINED:', name);
    console.log('MEETING CODE:', roomId);
    console.log('PARTICIPANTS:', room.size);

    respond(callback, {
      ok: true,
      roomId
    });

  } catch (error) {
    console.error('JOIN ROOM ERROR:', error);

    respond(callback, {
      ok: false,
      error: 'Server error while joining the meeting.'
    });
  }
}

// RESUME A TEMPORARILY DISCONNECTED PARTICIPANT

async function resumeRoom(socket, data, callback) {
  try {
    if (socket.data.roomId) {
      return respond(callback, {
        ok: false,
        error: 'You are already in a meeting.'
      });
    }

    const roomId = String(data?.roomId || '')
      .trim()
      .toUpperCase();

    const previousSocketId = String(
      data?.previousSocketId || ''
    );

    const room = rooms.get(roomId);

    if (!room || !previousSocketId) {
      return respond(callback, {
        ok: false,
        error: 'The meeting could not be recovered. Please rejoin.'
      });
    }

    const previousUser = room.get(previousSocketId);

    if (!previousUser || !previousUser.disconnected) {
      return respond(callback, {
        ok: false,
        error: 'Your previous meeting connection has expired. Please rejoin.'
      });
    }

    if (previousUser.disconnectTimer) {
      clearTimeout(previousUser.disconnectTimer);
    }

    const name = previousUser.name;

    room.delete(previousSocketId);

    room.set(socket.id, {
      name,
      disconnected: false,
      disconnectTimer: null
    });

    await socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;

    const existingUsers = [...room.entries()]
      .filter(([id, user]) =>
        id !== socket.id && !user.disconnected
      )
      .map(([id, user]) => ({
        id,
        name: user.name
      }));

    socket.emit('room-users', existingUsers);

    socket.to(roomId).emit('user-reconnected', {
      oldId: previousSocketId,
      id: socket.id,
      name
    });

    console.log('USER RECONNECTED:', name);
    console.log('MEETING CODE:', roomId);

    respond(callback, {
      ok: true,
      roomId
    });

  } catch (error) {
    console.error('RESUME ROOM ERROR:', error);

    respond(callback, {
      ok: false,
      error: 'Server error while restoring the meeting.'
    });
  }
}

// REMOVE A USER COMPLETELY

function removeUserFromRoom(roomId, socketId) {
  const room = rooms.get(roomId);

  if (!room) return;

  const user = room.get(socketId);

  if (!user) return;

  if (user.disconnectTimer) {
    clearTimeout(user.disconnectTimer);
  }

  room.delete(socketId);

  io.to(roomId).emit('user-left', {
    id: socketId
  });

  if (room.size === 0) {
    rooms.delete(roomId);
    console.log('ROOM DELETED:', roomId);
  } else {
    console.log('PARTICIPANTS REMAINING:', room.size);
  }
}

// INTENTIONAL LEAVE

function leaveRoom(socket) {
  const roomId = socket.data.roomId;

  if (!roomId) return;

  const room = rooms.get(roomId);

  socket.leave(roomId);

  if (room) {
    const user = room.get(socket.id);

    if (user?.disconnectTimer) {
      clearTimeout(user.disconnectTimer);
    }

    room.delete(socket.id);

    io.to(roomId).emit('user-left', {
      id: socket.id
    });

    if (room.size === 0) {
      rooms.delete(roomId);
      console.log('ROOM DELETED:', roomId);
    } else {
      console.log('PARTICIPANTS REMAINING:', room.size);
    }
  }

  console.log(
    `${socket.data.name || 'Guest'} left room ${roomId}`
  );

  delete socket.data.roomId;
  delete socket.data.name;
}

// TEMPORARY DISCONNECTION

function handleTemporaryDisconnect(socket) {
  const roomId = socket.data.roomId;

  if (!roomId) return;

  const room = rooms.get(roomId);

  if (!room) return;

  const user = room.get(socket.id);

  if (!user) return;

  user.disconnected = true;

  user.disconnectTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomId);

    if (!currentRoom) return;

    const currentUser = currentRoom.get(socket.id);

    if (!currentUser || !currentUser.disconnected) {
      return;
    }

    console.log(
      'RECONNECTION TIME EXPIRED:',
      currentUser.name,
      roomId
    );

    removeUserFromRoom(roomId, socket.id);

  }, RECONNECT_GRACE_PERIOD);

  console.log(
    'TEMPORARY DISCONNECTION:',
    user.name,
    roomId
  );
}

// SOCKET CONNECTION

io.on('connection', socket => {
  console.log('--------------------------------');
  console.log('CLIENT CONNECTED:', socket.id);
  console.log('TRANSPORT:', socket.conn.transport.name);

  socket.onAny(event => {
    console.log('EVENT RECEIVED:', event);
  });

  socket.on('create-room', (data, callback) => {
    createRoom(socket, data || {}, callback);
  });

  socket.on('join-room', (data, callback) => {
    joinRoom(socket, data || {}, callback);
  });

  socket.on('resume-room', (data, callback) => {
    resumeRoom(socket, data || {}, callback);
  });

  const signalingEvents = [
    'offer',
    'answer',
    'ice-candidate'
  ];

  for (const event of signalingEvents) {
    socket.on(event, payload => {
      try {
        if (!payload || !payload.to) return;

        const roomId = socket.data.roomId;

        if (!roomId) return;

        const room = rooms.get(roomId);

        if (!room || !room.has(socket.id)) return;

        if (!room.has(payload.to)) return;

        const targetUser = room.get(payload.to);

        if (!targetUser || targetUser.disconnected) return;

        io.to(payload.to).emit(event, {
          ...payload,
          from: socket.id
        });

      } catch (error) {
        console.error('SIGNALING ERROR:', event, error);
      }
    });
  }

  socket.on('leave-room', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', reason => {
    console.log('CLIENT DISCONNECTED:', socket.id);
    console.log('REASON:', reason);

    handleTemporaryDisconnect(socket);
  });

  socket.on('error', error => {
    console.error('SOCKET ERROR:', error);
  });
});

// SERVER ERRORS

server.on('error', error => {
  console.error('HTTP SERVER ERROR:', error);
});

// START SERVER

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log('MEET LITE SERVER STARTED');
  console.log(`PORT: ${PORT}`);
  console.log('HOST: 0.0.0.0');
  console.log('================================');
});
