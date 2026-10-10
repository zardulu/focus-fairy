import React from 'react';
import AuthButton from './AuthButton';
import { useAuth } from '../contexts/AuthContext';

interface FocusShellProps {
    children: React.ReactNode;
    onApiKeyClick?: () => void;
    displayDate?: string;
}

const FocusShell: React.FC<FocusShellProps> = ({ children, onApiKeyClick, displayDate }) => {
    const { user } = useAuth();

    return (
        <div
            className="focus-shell min-h-screen w-full flex flex-col items-center justify-center px-0 py-4 sm:p-4 relative"
            style={{ backgroundColor: 'var(--bg-warm)' }}
        >
            {/* Shared app chrome stays mounted while the conversation starts. */}
            <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 sm:gap-3">
                <AuthButton />

                <button
                    onClick={onApiKeyClick}
                    className="btn-dark"
                >
                    Settings
                </button>

                <div className="relative group">
                    <button
                        className="w-8 h-8 rounded-full flex items-center justify-center border transition-colors"
                        style={{
                            borderColor: 'var(--border-light)',
                            color: 'var(--text-muted)',
                            backgroundColor: 'white'
                        }}
                        aria-label="About Focus Fairy"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>

                    <div
                        className="absolute right-0 top-10 w-64 sm:w-72 p-3 sm:p-4 rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
                        style={{
                            backgroundColor: 'white',
                            border: '1px solid var(--border-light)'
                        }}
                    >
                        <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-dark)' }}>
                            About Focus Fairy
                        </h3>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                            A gentle focus companion that helps you focus on your tasks by checking in on your progress.
                            <strong> Bring your own API key</strong> (Gemini, OpenAI, etc).
                            {user ? ' Your chat history and AI provider settings are synced to your account.' : ' Chats are ephemeral. Sign in to save your history and settings across devices.'}
                            Keep this tab open for reliable check-in notifications.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-center w-full" style={{ maxWidth: '600px' }}>
                <h1
                    className="font-title text-3xl sm:text-4xl font-semibold italic mb-0"
                    style={{ color: 'var(--text-dark)' }}
                >
                    Focus Fairy ✨
                </h1>
                {displayDate && (
                    <p
                        className="text-xs mt-1 mb-0"
                        style={{
                            color: 'var(--text-muted)',
                            opacity: 0.7,
                            letterSpacing: '0.02em',
                        }}
                    >
                        {displayDate}
                    </p>
                )}

                <div className="focus-content w-full">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default FocusShell;
