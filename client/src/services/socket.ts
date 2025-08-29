import { io, Socket } from 'socket.io-client';
import { SocketTextChangeEvent } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

class SocketService {
  private socket: Socket | null = null;
  private callbacks: Map<string, Function[]> = new Map();

  connect(): void {
    if (this.socket?.connected) return;

    this.socket = io(SOCKET_URL, {
      autoConnect: true,
    });

    this.socket.on('connect', () => {
      console.log('🔌 Connected to server:', this.socket?.id);
    });

    this.socket.on('disconnect', () => {
      console.log('🔌 Disconnected from server');
    });

    this.socket.on('text-change', (data: SocketTextChangeEvent) => {
      this.emit('text-change', data);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.callbacks.clear();
  }

  joinFile(fileId: string): void {
    if (this.socket) {
      this.socket.emit('join-file', fileId);
      console.log(`📄 Joined file room: ${fileId}`);
    }
  }

  leaveFile(fileId: string): void {
    if (this.socket) {
      this.socket.emit('leave-file', fileId);
      console.log(`📄 Left file room: ${fileId}`);
    }
  }

  sendTextChange(data: SocketTextChangeEvent): void {
    if (this.socket) {
      this.socket.emit('text-change', data);
    }
  }

  // Event subscription system
  on(event: string, callback: Function): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)?.push(callback);
  }

  off(event: string, callback: Function): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Export singleton instance
export const socketService = new SocketService();
export default socketService;
