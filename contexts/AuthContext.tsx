import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { onAuthStateChange, signInWithGoogle, signOut as authSignOut } from '../services/authService';
import { isFirebaseConfigured } from '../firebase.config';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  isFirebaseConfigured: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  isFirebaseConfigured: false,
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChange((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    if (!isFirebaseConfigured) return;
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign-in failed:', error);
      setLoading(false);
      throw error;
    }
  };

  const signOut = async () => {
    if (!isFirebaseConfigured) return;
    setLoading(true);
    try {
      await authSignOut();
    } catch (error) {
      console.error('Sign-out failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isFirebaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
};
