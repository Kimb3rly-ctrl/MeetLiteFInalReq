
import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export interface PeerInfo {
  id: string;
  name: string;
}

export interface SignalPayload {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

@Injectable({
  providedIn: 'root'
})
export class MeetService {
  readonly serverUrl =
    'https://meet-lite-server-eon2.onrender.com';

  private socket?: Socket;

  connect(): Socket {
    if (this.socket) {
      return this.socket;
    }

    this.socket = io(this.serverUrl, {
      transports: ['polling'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000
    });

    this.socket.on('connect', () => {
      console.log('CONNECTED:', this.socket?.id);
    });

    this.socket.on('connect_error', error => {
      console.error(
        'SOCKET CONNECTION ERROR:',
        error.message
      );
    });

    this.socket.on('disconnect', reason => {
      console.log('SOCKET DISCONNECTED:', reason);
    });

    this.socket.on('reconnect_attempt', attempt => {
      console.log('RECONNECT ATTEMPT:', attempt);
    });

    this.socket.on('reconnect_error', error => {
      console.error('RECONNECT ERROR:', error.message);
    });

    this.socket.on('reconnect', attempt => {
      console.log('RECONNECTED:', attempt);
    });

    return this.socket;
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    const oldSocket = this.socket;

    oldSocket.io.reconnection(false);
    oldSocket.removeAllListeners();
    oldSocket.disconnect();

    this.socket = undefined;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }
}
