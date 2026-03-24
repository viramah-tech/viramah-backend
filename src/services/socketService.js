const { Server } = require('socket.io');

let io = null;

const initializeSocket = (httpServer) => {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000').split(',').map(s => s.trim());

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Allow clients to join a user-specific room for targeted updates
    socket.on('join:user', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`Socket ${socket.id} joined room user:${userId}`);
      }
    });

    // Allow admin/accountant clients to join the admin room
    socket.on('join:admin', () => {
      socket.join('admin');
      console.log(`Socket ${socket.id} joined admin room`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return io;
};

// Emit to all admin/accountant clients
const emitToAdmins = (event, data) => {
  if (io) {
    io.to('admin').emit(event, data);
  }
};

// Emit to a specific user
const emitToUser = (userMongoId, event, data) => {
  if (io) {
    io.to(`user:${userMongoId}`).emit(event, data);
  }
};

// Emit to all connected clients
const emitToAll = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};

module.exports = {
  initializeSocket,
  getIO,
  emitToAdmins,
  emitToUser,
  emitToAll,
};
