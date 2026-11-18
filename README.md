# Meet Lite — Ionic Angular group video calls

A lightweight WebRTC mesh video meeting starter for Android (Capacitor) and browser development. Users create or join a room with a short code. The signaling server relays WebRTC offers, answers, and ICE candidates; it does **not** relay or record audio/video.

## Requirements

- Node.js 20 LTS (recommended)
- Android Studio + Android SDK
- Java 17
- Ionic CLI: `npm install -g @ionic/cli`

## 1. Install dependencies

From this project folder:

```bash
npm install
cd server
npm install
cd ..
```

## 2. Start the signaling server

```bash
cd server
npm start
```

The server listens on port 3000. Open `http://localhost:3000` on the development computer; it should return JSON with `"status":"ok"`.

Find your computer's local IPv4 address:
- Windows: run `ipconfig` and find the active Wi-Fi adapter's IPv4 Address.
- macOS/Linux: use `ifconfig` or `ip addr`.

## 3. Configure the server URL

Edit `src/app/services/meet.service.ts`:

```ts
readonly serverUrl = 'http://192.168.1.20:3000';
```

Replace `192.168.1.20` with your computer's actual LAN IP. All Android phones and the computer running the server should be on the same Wi-Fi for the simplest test. Allow inbound TCP port 3000 through your computer firewall.

For browser testing on the same computer, you can use `http://localhost:3000`.

## 4. Run in browser

In the project root:

```bash
npm start
```

Open the URL printed by Angular, normally `http://localhost:4200`. Camera/microphone access is permitted on localhost. For a browser on another device, use HTTPS; browsers generally block camera/microphone access on insecure LAN HTTP origins.

## 5. Build and run Android

In the project root:

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio, wait for Gradle sync, choose a phone or emulator, then press Run.

**Android manifest permissions (after `npx cap add android`):** open `android/app/src/main/AndroidManifest.xml` and add these directly inside the `<manifest>` element, before `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

For local-network HTTP testing only, add `android:usesCleartextTraffic="true"` to the existing `<application ...>` element. This is a development convenience; use HTTPS/WSS in production. Re-sync/build after editing the manifest:

```bash
npx cap sync android
```

The app will request camera and microphone access when you join a call.

If Android cannot connect to your PC server:
- Confirm both devices are on the same Wi-Fi.
- Check the server URL uses the PC's LAN IP, not `localhost`.
- Allow port 3000 in Windows Firewall.
- Verify `http://PC_LAN_IP:3000` is reachable from the phone browser.

The included Capacitor config allows mixed content for local development. For production, serve signaling over HTTPS/WSS and remove development-only insecure settings.

## 6. Test a group call

1. Install/run the app on Phone A and Phone B (and optionally Phone C).
2. On Phone A, enter a display name and tap **Create a new meeting**.
3. Tap the meeting code to copy it, then send it to the other phones.
4. On the other phones, enter the same code and tap **Join meeting**.
5. Allow camera and microphone access. Each device should see the others.
6. Use Mute, Stop video, Flip, and Leave controls.

## Important networking notes

- This starter uses a peer-to-peer **mesh**: each participant sends a separate media stream to every other participant. It is suitable for demos and small groups (roughly 2–4 phones; performance depends on device/network). For larger meetings, use an SFU such as LiveKit, mediasoup, or Janus.
- Public STUN servers are configured. STUN alone cannot traverse every carrier/mobile/Wi-Fi NAT. For reliable calls across unrelated networks, configure a TURN server (for example, coturn) and add its `urls`, `username`, and `credential` to `rtcConfig.iceServers` in `home.page.ts`. Never expose a permanent TURN secret in a public mobile app; use time-limited credentials from your backend.
- The signaling server must be reachable by all participants. For calls over the public internet, deploy it to a public host with HTTPS/WSS and update `serverUrl`.
- Do not use this development server as-is for production: add authentication, room access controls, rate limiting, HTTPS, TURN credentials, and privacy/security review.
- WebRTC media is encrypted in transit by DTLS-SRTP. The signaling service is not an end-to-end identity/authentication system.

## Troubleshooting

- **Camera permission denied:** enable Camera and Microphone permissions for Meet Lite in Android Settings, then reopen the app.
- **No remote video:** verify the server URL, firewall, and that both devices joined exactly the same room code.
- **Connects on Wi-Fi but not mobile data:** deploy signaling publicly and add a TURN server. STUN-only connections are not guaranteed to work across all networks.
- **Camera preview blank:** close other apps using the camera and retry.
- **Build errors:** use Node 20 and Java 17, then run `npm install` and `npx cap sync android` again.

## Project layout

```text
ionic-meet-lite/
├── src/                  # Ionic Angular app
├── server/               # Socket.IO signaling server
├── capacitor.config.ts
├── angular.json
└── README.md
```
