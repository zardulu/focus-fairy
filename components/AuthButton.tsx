import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const AuthButton: React.FC = () => {
  const { user, loading, signIn, signOut, isFirebaseConfigured } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Safe fallback if Firebase config is missing
  if (!isFirebaseConfigured) {
    return null;
  }

  if (loading) {
    return (
      <div 
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--accent-pink)', borderTopColor: 'transparent' }}
      />
    );
  }

  if (!user) {
    return (
      <button
        onClick={() => void signIn()}
        className="auth-btn auth-btn-signin"
        style={{
          borderColor: 'var(--border-light)',
          backgroundColor: 'white',
          color: 'var(--text-dark)',
        }}
      >
        {/* Google Icon SVG */}
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9577C16.6609 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
          <path d="M9 18C11.43 18 13.4673 17.1941 14.9577 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
          <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
          <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
        </svg>
        <span className="sm:inline hidden">Sign in</span>
      </button>
    );
  }

  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'User';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="auth-btn auth-btn-user"
        aria-expanded={isOpen}
        aria-haspopup="true"
        style={{
          borderColor: 'var(--border-light)',
          backgroundColor: 'white',
          color: 'var(--text-dark)',
        }}
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || 'User profile'}
            className="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <div 
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
            style={{ backgroundColor: 'var(--accent-pink)', color: 'white' }}
          >
            {firstName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="sm:inline hidden font-medium">{firstName}</span>
      </button>

      {isOpen && (
        <div
          className="auth-dropdown animate-fadeIn"
          style={{
            backgroundColor: 'white',
            border: '1px solid var(--border-light)',
          }}
        >
          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-dark)' }}>
              {user.displayName}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {user.email}
            </p>
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              void signOut();
            }}
            className="w-full text-left px-4 py-2 text-xs hover:bg-transparent transition-colors"
            style={{ color: 'var(--text-dark)' }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
};

export default AuthButton;
