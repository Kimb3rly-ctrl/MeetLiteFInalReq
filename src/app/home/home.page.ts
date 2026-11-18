
import { CommonModule } from '@angular/common';

import {
  Component,
  ElementRef,
  OnDestroy,
  AfterViewChecked,
  ViewChild
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonIcon,
  IonSpinner,
  IonToast
} from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';

import {
  videocam,
  videocamOff,
  mic,
  micOff,
  call,
  copy,
  people,
  cameraReverse
} from 'ionicons/icons';

import {
  MeetService,
  PeerInfo
} from '../services/meet.service';

import { Socket } from 'socket.io-client';

interface PeerConnectionEntry {
  pc: RTCPeerConnection;
  name: string;
  stream?: MediaStream;
}

@Component({
  selector: 'app-home',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButton,
    IonInput,
    IonItem,
    IonLabel,
    IonIcon,
    IonSpinner,
    IonToast
  ],

  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss']
})
export class HomePage implements OnDestroy, AfterViewChecked {

  @ViewChild('localVideo')
  localVideo?: ElementRef<HTMLVideoElement>;

  @ViewChild('remoteVideos')
  remoteVideos?: ElementRef<HTMLDivElement>;

  name = 'Guest';
  roomId = '';

  joined = false;
  connecting = false;
  muted = false;
  cameraOff = false;
  toastMessage = '';

  participants: PeerInfo[] = [];

  localStream?: MediaStream;

  private socket?: Socket;

  private peers = new Map<string, PeerConnectionEntry>();

  private pendingCandidates =
    new Map<string, RTCIceCandidateInit[]>();

  switchingCamera = false;

  private lastCameraDeviceId?: string;

  private readonly rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  constructor(private meet: MeetService) {

    addIcons({
      videocam,
      videocamOff,
      mic,
      micOff,
      call,
      copy,
      people,
      cameraReverse
    });

  }

  // CREATE NEW MEETING
  async createRoom(): Promise<void> {

    if (this.joined || this.connecting) return;

    // Do not generate a room code in the frontend.
    // The server generates it once and returns it.

    await this.startMeeting('create-room');

  }

  // JOIN EXISTING MEETING
  async joinRoom(): Promise<void> {

    if (this.joined || this.connecting) return;

    const enteredCode = this.roomId
      .trim()
      .toUpperCase();

    if (!enteredCode) {
      this.toast('Enter a meeting code first.');
      return;
    }

    this.roomId = enteredCode;

    await this.startMeeting('join-room');

  }

  // START MEETING
  private async startMeeting(
    action: 'create-room' | 'join-room'
  ): Promise<void> {

    if (this.connecting || this.joined) return;

    this.connecting = true;

    try {

      // Request camera and microphone.
      this.localStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: 'user'
          }
        });

      const initialTrack =
        this.localStream.getVideoTracks()[0];

      this.lastCameraDeviceId =
        initialTrack?.getSettings().deviceId;

      if (this.localVideo) {

        this.localVideo.nativeElement.srcObject =
          this.localStream;

        await this.localVideo.nativeElement
          .play()
          .catch(() => undefined);

      }

      // Connect to signaling server.
      this.socket = this.meet.connect();

      this.bindSocketEvents();

      // Wait for socket connection.
      if (!this.socket.connected) {

        await new Promise<void>((resolve, reject) => {

          const timeout = setTimeout(() => {
            reject(
              new Error(
                'Cannot reach signaling server. Check server URL and Wi-Fi.'
              )
            );
          }, 15000);

          this.socket!.once('connect', () => {
            clearTimeout(timeout);
            resolve();
          });

          this.socket!.once('connect_error', (error: Error) => {
            clearTimeout(timeout);
            reject(error);
          });

        });

      }

      // Prepare the correct request.
      const payload = action === 'create-room'
        ? {
            name: this.name.trim() || 'Guest'
          }
        : {
            roomId: this.roomId.trim().toUpperCase(),
            name: this.name.trim() || 'Guest'
          };

      console.log('SENDING REQUEST:', action, payload);

      // Request acknowledgement from server.
      const result = await new Promise<{
        ok: boolean;
        roomId?: string;
        error?: string;
      }>((resolve, reject) => {

        const timeout = setTimeout(() => {
          reject(
            new Error(
              'The server did not respond. Please try again.'
            )
          );
        }, 15000);

        this.socket!.emit(
          action,
          payload,
          (response: {
            ok: boolean;
            roomId?: string;
            error?: string;
          }) => {

            clearTimeout(timeout);

            console.log('SERVER RESPONSE:', response);

            resolve(response);

          }
        );

      });

      if (!result || !result.ok || !result.roomId) {

        throw new Error(
          result?.error || 'Could not enter the meeting.'
        );

      }

      // Use the exact room ID returned by the server.
      this.roomId = result.roomId;

      this.joined = true;

      this.muted = false;
      this.cameraOff = false;

      this.toast(
        action === 'create-room'
          ? 'Meeting created. Share the meeting code!'
          : 'Joined meeting successfully.'
      );

    } catch (error) {

      console.error('MEETING ERROR:', error);

      this.joined = false;

      this.peers.forEach((_, id) => {
        this.closePeer(id);
      });

      this.participants = [];

      this.stopLocalMedia();

      this.meet.disconnect();

      this.socket = undefined;

      this.toast(
        error instanceof Error
          ? error.message
          : 'Could not start the meeting.'
      );

    } finally {

      this.connecting = false;

    }

  }

  // REFRESH LOCAL VIDEO
  ngAfterViewChecked(): void {

    if (
      this.localStream &&
      this.localVideo?.nativeElement.srcObject !== this.localStream
    ) {

      this.localVideo!.nativeElement.srcObject =
        this.localStream;

      this.localVideo!.nativeElement
        .play()
        .catch(() => undefined);

    }

  }

  // SOCKET EVENTS
  private bindSocketEvents(): void {

    if (!this.socket) return;

    this.socket.off('room-users');
    this.socket.off('user-joined');
    this.socket.off('user-left');
    this.socket.off('offer');
    this.socket.off('answer');
    this.socket.off('ice-candidate');
    this.socket.off('room-error');

    this.socket.on(
      'room-users',
      async (users: PeerInfo[]) => {

        this.participants = [
          {
            id: this.socket!.id || 'self',
            name: this.name + ' (You)'
          },
          ...users
        ];

        for (const user of users) {
          await this.createOffer(user.id, user.name);
        }

      }
    );

    this.socket.on(
      'user-joined',
      (user: PeerInfo) => {

        if (
          !this.participants.some(
            participant => participant.id === user.id
          )
        ) {

          this.participants = [
            ...this.participants,
            user
          ];

        }

      }
    );

    this.socket.on(
      'user-left',
      ({ id }: { id: string }) => {

        this.closePeer(id);

        this.participants =
          this.participants.filter(
            participant => participant.id !== id
          );

      }
    );

    this.socket.on(
      'offer',
      async (data: {
        from: string;
        name: string;
        description: RTCSessionDescriptionInit;
      }) => {

        const entry = this.getPeer(
          data.from,
          data.name
        );

        await entry.pc.setRemoteDescription(
          new RTCSessionDescription(data.description)
        );

        await this.flushCandidates(
          data.from,
          entry.pc
        );

        const answer = await entry.pc.createAnswer();

        await entry.pc.setLocalDescription(answer);

        this.socket!.emit('answer', {
          to: data.from,
          description: entry.pc.localDescription
        });

      }
    );

    this.socket.on(
      'answer',
      async (data: {
        from: string;
        description: RTCSessionDescriptionInit;
      }) => {

        const entry = this.peers.get(data.from);

        if (entry) {

          await entry.pc.setRemoteDescription(
            new RTCSessionDescription(data.description)
          );

          await this.flushCandidates(
            data.from,
            entry.pc
          );

        }

      }
    );

    this.socket.on(
      'ice-candidate',
      async (data: {
        from: string;
        candidate: RTCIceCandidateInit;
      }) => {

        const entry = this.peers.get(data.from);

        if (entry?.pc.remoteDescription) {

          await entry.pc.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );

        } else {

          const list =
            this.pendingCandidates.get(data.from) || [];

          list.push(data.candidate);

          this.pendingCandidates.set(
            data.from,
            list
          );

        }

      }
    );

    this.socket.on(
      'room-error',
      (message: string) => this.toast(message)
    );

  }

  // GET OR CREATE PEER
  private getPeer(
    id: string,
    name: string
  ): PeerConnectionEntry {

    const existing = this.peers.get(id);

    if (existing) return existing;

    const pc = new RTCPeerConnection(
      this.rtcConfig
    );

    const entry: PeerConnectionEntry = {
      pc,
      name
    };

    this.peers.set(id, entry);

    this.localStream?.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream!);
    });

    pc.onicecandidate = event => {

      if (event.candidate) {

        this.socket?.emit('ice-candidate', {
          to: id,
          candidate: event.candidate.toJSON()
        });

      }

    };

    pc.ontrack = event => {

      const stream = event.streams[0];

      entry.stream = stream;

      this.renderRemoteVideo(
        id,
        name,
        stream
      );

    };

    pc.onconnectionstatechange = () => {

      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.closePeer(id);
      }

    };

    return entry;

  }

  // CREATE WEBRTC OFFER
  private async createOffer(
    id: string,
    name: string
  ): Promise<void> {

    const entry = this.getPeer(id, name);

    const offer = await entry.pc.createOffer();

    await entry.pc.setLocalDescription(offer);

    this.socket?.emit('offer', {
      to: id,
      name: this.name,
      description: entry.pc.localDescription
    });

  }

  // FLUSH PENDING ICE CANDIDATES
  private async flushCandidates(
    id: string,
    pc: RTCPeerConnection
  ): Promise<void> {

    const candidates =
      this.pendingCandidates.get(id) || [];

    this.pendingCandidates.delete(id);

    for (const candidate of candidates) {

      await pc.addIceCandidate(
        new RTCIceCandidate(candidate)
      );

    }

  }

  // DISPLAY REMOTE VIDEO
  private renderRemoteVideo(
    id: string,
    name: string,
    stream: MediaStream
  ): void {

    const host = this.remoteVideos?.nativeElement;

    if (!host) return;

    let tile = host.querySelector<HTMLElement>(
      `[data-peer="${id}"]`
    );

    if (!tile) {

      tile = document.createElement('div');

      tile.className = 'video-tile';

      tile.dataset['peer'] = id;

      const video = document.createElement('video');

      video.autoplay = true;
      video.playsInline = true;

      const caption = document.createElement('div');

      caption.className = 'video-caption';
      caption.textContent = name;

      tile.append(video, caption);

      host.append(tile);

    }

    const video = tile.querySelector('video');

    if (
      video &&
      video.srcObject !== stream
    ) {

      video.srcObject = stream;

      video.play().catch(() => undefined);

    }

  }

  // MICROPHONE
  toggleMic(): void {

    this.muted = !this.muted;

    this.localStream
      ?.getAudioTracks()
      .forEach(track => {
        track.enabled = !this.muted;
      });

  }

  // CAMERA
  toggleCamera(): void {

    this.cameraOff = !this.cameraOff;

    this.localStream
      ?.getVideoTracks()
      .forEach(track => {
        track.enabled = !this.cameraOff;
      });

  }

  // SWITCH CAMERA
  async switchCamera(): Promise<void> {

    if (
      this.switchingCamera ||
      !this.localStream
    ) {
      return;
    }

    this.switchingCamera = true;

    const oldTrack =
      this.localStream.getVideoTracks()[0];

    if (!oldTrack) {

      this.switchingCamera = false;

      this.toast('No active camera found.');

      return;

    }

    const oldSettings = oldTrack.getSettings();

    const oldDeviceId =
      oldSettings.deviceId ||
      this.lastCameraDeviceId;

    const oldFacing = oldSettings.facingMode;

    let newTrack: MediaStreamTrack | undefined;

    try {

      const devices =
        await navigator.mediaDevices.enumerateDevices();

      const cameras = devices.filter(
        device => device.kind === 'videoinput'
      );

      if (cameras.length < 2) {
        throw new Error('Only one camera is available.');
      }

      let currentIndex = cameras.findIndex(
        camera => camera.deviceId === oldDeviceId
      );

      if (currentIndex < 0) currentIndex = 0;

      const nextCamera =
        cameras[(currentIndex + 1) % cameras.length];

      if (!nextCamera) {
        throw new Error('Could not find another camera.');
      }

      oldTrack.stop();

      this.localStream.removeTrack(oldTrack);

      await new Promise<void>(resolve => {
        setTimeout(resolve, 300);
      });

      try {

        const replacementStream =
          await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: {
                exact: nextCamera.deviceId
              }
            }
          });

        newTrack = replacementStream.getVideoTracks()[0];

      } catch {

        const nextFacing =
          oldFacing === 'environment'
            ? 'user'
            : 'environment';

        const replacementStream =
          await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: {
                ideal: nextFacing
              }
            }
          });

        newTrack = replacementStream.getVideoTracks()[0];

      }

      if (!newTrack) {
        throw new Error('Could not open the replacement camera.');
      }

      newTrack.enabled = !this.cameraOff;

      for (const entry of this.peers.values()) {

        const sender = entry.pc
          .getSenders()
          .find(s => s.track?.kind === 'video');

        if (sender) {
          await sender.replaceTrack(newTrack);
        }

      }

      this.localStream.addTrack(newTrack);

      this.lastCameraDeviceId =
        newTrack.getSettings().deviceId ||
        nextCamera.deviceId;

      if (this.localVideo) {

        this.localVideo.nativeElement.srcObject =
          this.localStream;

        await this.localVideo.nativeElement
          .play()
          .catch(() => undefined);

      }

    } catch (error) {

      console.error('Camera switching failed:', error);

      if (newTrack) {

        newTrack.stop();

        this.localStream.removeTrack(newTrack);

      }

      try {

        const restoredStream =
          await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: oldDeviceId
              ? { deviceId: { exact: oldDeviceId } }
              : { facingMode: { ideal: oldFacing || 'user' } }
          });

        const restoredTrack =
          restoredStream.getVideoTracks()[0];

        if (restoredTrack) {

          restoredTrack.enabled = !this.cameraOff;

          for (const entry of this.peers.values()) {

            const sender = entry.pc
              .getSenders()
              .find(s => s.track?.kind === 'video');

            if (sender) {
              await sender.replaceTrack(restoredTrack);
            }

          }

          this.localStream.addTrack(restoredTrack);

          this.lastCameraDeviceId =
            restoredTrack.getSettings().deviceId ||
            oldDeviceId;

          if (this.localVideo) {

            this.localVideo.nativeElement.srcObject =
              this.localStream;

            await this.localVideo.nativeElement
              .play()
              .catch(() => undefined);

          }

        }

      } catch (restoreError) {

        console.error('Could not restore camera:', restoreError);

        this.toast(
          'Camera could not be restored. Please leave and rejoin.'
        );

        this.switchingCamera = false;

        return;

      }

      this.toast(
        'Could not switch camera. Check camera permission or device support.'
      );

    } finally {

      this.switchingCamera = false;

    }

  }

  // COPY MEETING CODE
  async copyRoom(): Promise<void> {

    if (!this.roomId) return;

    try {

      await navigator.clipboard.writeText(this.roomId);

      this.toast('Meeting code copied.');

    } catch {

      this.toast('Meeting code: ' + this.roomId);

    }

  }

  // LEAVE MEETING
  leaveRoom(): void {

    this.socket?.emit('leave-room');

    this.peers.forEach((_, id) => {
      this.closePeer(id);
    });

    this.participants = [];

    this.joined = false;

    this.roomId = '';

    this.stopLocalMedia();

    this.meet.disconnect();

    this.socket = undefined;

    this.lastCameraDeviceId = undefined;

    this.switchingCamera = false;

  }

  // CLOSE PEER
  private closePeer(id: string): void {

    const entry = this.peers.get(id);

    entry?.pc.close();

    this.peers.delete(id);

    this.pendingCandidates.delete(id);

    this.remoteVideos
      ?.nativeElement
      .querySelector(`[data-peer="${id}"]`)
      ?.remove();

  }

  // STOP CAMERA AND MICROPHONE
  private stopLocalMedia(): void {

    this.localStream
      ?.getTracks()
      .forEach(track => track.stop());

    this.localStream = undefined;

    this.lastCameraDeviceId = undefined;

    if (this.localVideo) {
      this.localVideo.nativeElement.srcObject = null;
    }

  }

  // TOAST MESSAGE
  private toast(message: string): void {

    this.toastMessage = message;

  }

  // CLEANUP
  ngOnDestroy(): void {

    if (this.joined) {
      this.leaveRoom();
    } else {
      this.stopLocalMedia();
    }

  }

}
