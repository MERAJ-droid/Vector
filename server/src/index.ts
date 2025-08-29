import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pool from './config/database';

// Import routes (we'll create these next)
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import fileRoutes from './routes/files';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes);

// Basic health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Join file room for real-time collaboration
  socket.on('join-file', (fileId: string) => {
    socket.join(`file-${fileId}`);
    console.log(`📄 User ${socket.id} joined file room: ${fileId}`);
  });

  // Leave file room
  socket.on('leave-file', (fileId: string) => {
    socket.leave(`file-${fileId}`);
    console.log(`📄 User ${socket.id} left file room: ${fileId}`);
  });

  // Handle text changes (naive implementation for Phase 1)
  socket.on('text-change', (data: { fileId: string; content: string; userId: string }) => {
    // Broadcast to all other users in the same file room
    socket.to(`file-${data.fileId}`).emit('text-change', data);
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
