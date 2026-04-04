import React, { useEffect, useState } from 'react';
import StreamingText from './StreamingText';

interface InitialTaskInputProps {
    onTaskSubmit: (task: string) => void;
    isLoading: boolean;
    onApiKeyClick?: () => void;
}

const InitialTaskInput: React.FC<InitialTaskInputProps> = ({ onTaskSubmit, isLoading, onApiKeyClick }) => {
    const [task, setTask] = useState('');
    const [introText, setIntroText] = useState('');

    // Character limit for input
    const MAX_INPUT_CHARS = 280;
    const INTRO_MESSAGE = "Hi! I'm Focus Fairy! What task would you like to focus on today? I'll help break it down into manageable steps.";

    useEffect(() => {
        let isCancelled = false;

        const streamIntroMessage = async () => {
            for (let i = 0; i < INTRO_MESSAGE.length; i++) {
                if (isCancelled) return;
                setIntroText(INTRO_MESSAGE.slice(0, i + 1));
                await new Promise(resolve => setTimeout(resolve, 15));
            }
        };

        void streamIntroMessage();

        return () => {
            isCancelled = true;
        };
    }, []);

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
            <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 sm:gap-3">
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
                        className="absolute right-0 top-10 w-64 sm:w-72 p-3 sm:p-4 rounded-xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
                        style={{
                            backgroundColor: 'var(--bg-white)',
                            border: '1px solid var(--border-light)'
                        }}
                    >
                        <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-dark)' }}>
                            About Focus Fairy
                        </h3>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                            A gentle focus companion that helps you focus on your tasks by checking in on your progress.
                            <strong> Bring your own API key</strong> (Gemini, OpenAI, etc).
                            Chats are ephemeral and not saved anywhere. You will lose the chat if the page is refreshed or closed.
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
                    className="font-title text-3xl sm:text-4xl font-semibold italic mb-6 sm:mb-10"
                    style={{ color: 'var(--text-dark)' }}
                >
                {/* Chat View Container */}
                    Focus Fairy ✨
                </h1>

                {/* Fairy and Speech Bubble Container */}
                <div className="chat-view-wrapper w-full mb-8" style={{ height: 'auto', minHeight: '120px' }}>
                    <div className="chat-pair-container">
                        {/* AI Message - with fairy and bubble */}
                        <div className="ai-message-row">
                            <div className="fairy-container animate-float flex-shrink-0">
                                <img src="/fairy.svg" alt="Focus Fairy" />
                            </div>
                            <div className="speech-bubble-ai animate-fadeIn flex-1 min-w-0">
                                <StreamingText
                                    text={introText}
                                    particlesActive={introText.length > 0 && introText.length < INTRO_MESSAGE.length}
                                    className="text-sm leading-relaxed"
                                    style={{ color: 'var(--text-dark)' }}
                                />
                            </div>
                        </div>
                    </div>

                </div>

                {/* Input Form */}
                <div className="w-full input-form-container" style={{ paddingLeft: '140px' }}>
                    <form
                        onSubmit={handleSubmit}
                        className="flex items-center gap-2 sm:gap-3 w-full"
                    >
                        <input
                            type="text"
                            value={task}
                            onChange={(e) => {
                                if (e.target.value.length <= MAX_INPUT_CHARS) {
                                    setTask(e.target.value);
                                }
                            }}
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
                    <p className="text-xs mt-1 text-right" style={{
                        color: task.length >= MAX_INPUT_CHARS ? 'var(--accent-pink)' : 'var(--text-muted)',
                        opacity: task ? 1 : 0
                    }}>
                        {task.length}/{MAX_INPUT_CHARS}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default InitialTaskInput;
