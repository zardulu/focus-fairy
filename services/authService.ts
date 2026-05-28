import { GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, User } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../firebase.config';

export const signInWithGoogle = async (): Promise<User | null> => {
  if (!isFirebaseConfigured || !auth) {
    throw new Error('Firebase is not configured. Please add Firebase configuration to your .env.local file.');
  }
  const provider = new GoogleAuthProvider();
  // Prompt user to select account always for better switching experience
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

export const signOut = async (): Promise<void> => {
  if (!isFirebaseConfigured || !auth) return;
  await fbSignOut(auth);
};

export const onAuthStateChange = (callback: (user: User | null) => void): (() => void) => {
  if (!isFirebaseConfigured || !auth) {
    callback(null);
    return () => {};
  }
  return auth.onAuthStateChanged(callback);
};
