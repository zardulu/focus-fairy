import React, { useState } from 'react';

interface InitialTaskInputProps {
    onTaskSubmit: (task: string) => void;
    isLoading: boolean;
    onApiKeyClick?: () => void;
}

const InitialTaskInput: React.FC<InitialTaskInputProps> = ({ onTaskSubmit, isLoading, onApiKeyClick }) => {
    const [task, setTask] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (task.trim() && !isLoading) {
            onTaskSubmit(task);
        }
    };

    return (
        <div
            className="min-h-screen w-full flex flex-col items-center justify-center p-4 relative"
            style={{ backgroundColor: 'var(--bg-white)' }}
        >
            {/* Info Tooltip and Settings Button */}
            <div className="absolute top-6 right-6 flex items-center gap-3">
                {/* Info Tooltip */}
                <div className="relative group">
                    <button
                        className="w-8 h-8 rounded-full flex items-center justify-center border transition-colors"
                        style={{
                            borderColor: 'var(--border-light)',
                            color: 'var(--text-muted)',
                            backgroundColor: 'transparent'
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>

                    {/* Tooltip Content */}
                    <div
                        className="absolute right-0 top-10 w-72 p-4 rounded-xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
                        style={{
                            backgroundColor: 'var(--bg-white)',
                            border: '1px solid var(--border-light)'
                        }}
                    >
                        <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-dark)' }}>
                            About Focus Fairy
                        </h3>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                            A gentle focus companion that checks in on your progress.
                            <strong> Bring your own API key</strong> (Gemini, OpenAI, etc).
                            Chats are <strong>ephemeral</strong> and not saved anywhere.
                            Keep this tab open for reliable check-in notifications.
                        </p>
                    </div>
                </div>

                {/* Settings Button */}
                <button
                    onClick={onApiKeyClick}
                    className="btn-dark"
                >
                    Settings
                </button>
            </div>

            {/* Main Content */}
            <div className="flex flex-col items-center w-full" style={{ maxWidth: '600px' }}>
                {/* Title */}
                <h1
                    className="font-title text-4xl font-semibold italic mb-10"
                    style={{ color: 'var(--text-dark)' }}
                >
                    Focus Fairy
                </h1>

                {/* Fairy and Speech Bubble Container */}
                <div className="flex items-center w-full mb-8 gap-4">
                    {/* Fairy */}
                    <div className="fairy-container animate-float">
                        <img src="/fairy.svg" alt="Focus Fairy" />
                    </div>

                    {/* AI Speech Bubble */}
                    <div className="speech-bubble-ai animate-fadeIn">
                        <p
                            className="text-sm leading-relaxed"
                            style={{ color: 'var(--text-dark)' }}
                        >
                            Hi! I'm your Focus Fairy ✨ What task would you like to focus on today? I'll help break it down into manageable steps.
                        </p>
                    </div>

                    {/* Navigation Arrows */}
                    <div className="nav-arrows">
                        <div className="nav-arrow" style={{ opacity: 0.3 }}>
                            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 6L6 1L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <div className="nav-arrow" style={{ opacity: 0.3 }}>
                            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 2L6 7L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Input Form */}
                <form
                    onSubmit={handleSubmit}
                    className="flex items-center gap-3 w-full"
                    style={{ paddingLeft: '100px' }}
                >
                    <input
                        type="text"
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        placeholder=""
                        className="input-field flex-1"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        className="btn-send"
                        disabled={isLoading || !task.trim()}
                    >
                        {isLoading ? (
                            <div
                                className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                                style={{ borderColor: 'var(--text-dark)', borderTopColor: 'transparent' }}
                            />
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default InitialTaskInput;
