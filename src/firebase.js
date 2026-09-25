import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = [
  "apiKey",
  "authDomain",
  "databaseURL",
  "projectId",
  "appId",
];

const missing = requiredConfig.filter((key) => !firebaseConfig[key]);

if (missing.length > 0) {
  throw new Error(
    `Missing Firebase configuration: ${missing.join(", ")}. Copy .env.example to .env and add your Firebase web app configuration.`
  );
}

export const firebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getDatabase(firebaseApp);

export const CEREMONY_ID =
  import.meta.env.VITE_CEREMONY_ID?.trim() || "main";
