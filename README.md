# Digital Oil Lamp — Firebase Realtime Sync

This React + Vite version keeps one shared lamp state in Firebase Realtime Database.

When any connected device presses **Light the Next Lamp**, Firebase atomically increments the shared `litCount`. Every connected device listens to the same database path and immediately renders the same number of lit lamps.

## 1. Firebase Console setup

1. Go to https://console.firebase.google.com and create a project.
2. Open **Build > Realtime Database** and create a database.
3. Open **Build > Authentication > Sign-in method** and enable **Anonymous** sign-in.
4. In **Project settings > Your apps**, add a **Web app**.
5. Copy the web Firebase configuration values.
6. Copy `.env.example` to `.env` and fill in those values.
7. In Realtime Database > Rules, paste the contents of `database.rules.json` and publish.

## 2. Local run

```bash
npm install
npm run dev
```

Open the LAN URL shown by Vite on several devices connected to the same network, or deploy the app and open the deployed URL on several devices.

## 3. Test synchronization

- Open the page in two browser windows/devices.
- Wait until the button changes from `Connecting...` to `Light the Next Lamp`.
- Click once on either device.
- Both devices should immediately display the same newly lit lamp.
- Near-simultaneous clicks are safe because the app uses Firebase `runTransaction()`.
- Reset is global as well.

## 4. Deploy to Vercel

Add the same `VITE_FIREBASE_*` environment variables and `VITE_CEREMONY_ID` in the Vercel project settings, then redeploy.

## 5. Optional Firebase Hosting

The repository also includes `firebase.json`.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
npm run build
firebase deploy --only hosting,database
```

## Shared database path

By default all devices synchronize this value:

```text
ceremonies/main/litCount
```

Change `VITE_CEREMONY_ID` if you want a separate ceremony without affecting the old one.
