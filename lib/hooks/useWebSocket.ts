'use client'

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { logError } from '@/lib/safe-log';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Get JWT token from localStorage
    const token = localStorage.getItem('accessToken');

    if (!token) {
      console.warn('No auth token, WebSocket not connecting');
      return;
    }

    // Connect to WebSocket server
    const socket = io(process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080', {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('❌ WebSocket disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      logError('WebSocket connection error', error);
      setIsConnected(false);
    });

    // Heartbeat
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping');
      }
    }, 30000); // Ping every 30 seconds

    socket.on('pong', () => {
      // Connection is alive
    });

    socketRef.current = socket;

    // Cleanup on unmount
    return () => {
      clearInterval(pingInterval);
      socket.disconnect();
    };
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
  };
}
