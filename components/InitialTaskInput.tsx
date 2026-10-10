import React, { useEffect, useState } from 'react';
import StreamingText from './StreamingText';

interface InitialTaskInputProps {
    onTaskSubmit: (task: string) => void;
    isLoading: boolean;
    isInitializing?: boolean;
}

const InitialTaskInput: React.FC<InitialTaskInputProps> = ({ onTaskSubmit, isLoading, isInitializing }) => {
    const [task, setTask] = useState('');
    const [introText, setIntroText] = useState('');
    const [placeholderText, setPlaceholderText] = useState('');

    // Character limit for input
    const MAX_INPUT_CHARS = 280;
    const INTRO_MESSAGE = "Hi! I'm Focus Fairy! I'll help you focus on your daily tasks and check in on your progress. What tasks would you like to focus on today?.";
    const PLACEHOLDER_TEXT = "What should we focus on today?";

    useEffect(() => {
        let isCancelled = false;

        const streamText = async (text: string, onChunk: (partial: string) => void) => {
            for (let i = 0; i < text.length; i++) {
                if (isCancelled) return;
                onChunk(text.slice(0, i + 1));
                await new Promise(resolve => setTimeout(resolve, 15));
            }
        };

        const streamIntroThenPlaceholder = async () => {
            await streamText(INTRO_MESSAGE, setIntroText);
            if (isCancelled) return;
            await new Promise(resolve => setTimeout(resolve, 300));
            await streamText(PLACEHOLDER_TEXT, setPlaceholderText);
        };

        void streamIntroThenPlaceholder();

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
        <div className="focus-stage initial-focus-stage w-full">
            <div className="chat-view-wrapper initial-chat-view w-full mb-0">
                    <div className="chat-pair-container">
                        {/* AI Message - with fairy and bubble */}
                        <div className="ai-message-row">
                            <div className={`fairy-container animate-float flex-shrink-0${isInitializing || isLoading ? ' fairy-thinking' : ''}`}>
                                <img src="/fairy.svg" alt="Focus Fairy" />
                            </div>
                            {isInitializing ? (
                                <div className="sparkle-loading-wrapper animate-fadeIn flex-1 min-w-0">
                                    <div className="sparkle-loading" aria-label="Loading..." role="status">
                                        <span className="sparkle sparkle-large">✦</span>
                                        <span className="sparkle sparkle-small">✦</span>
                                        <span className="sparkle sparkle-medium">✦</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="speech-bubble-ai animate-fadeIn custom-scrollbar flex-1 min-w-0">
                                    <StreamingText
                                        text={introText}
                                        particlesActive={introText.length > 0 && introText.length < INTRO_MESSAGE.length}
                                        className="text-sm leading-relaxed"
                                        style={{ color: 'var(--text-dark)' }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                <div className="w-full input-form-container initial-input-form">
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
                            placeholder={placeholderText}
                            className="input-field flex-1"
                            disabled={isLoading || isInitializing}
                        />
                        <button
                            type="submit"
                            className="btn-send"
                            disabled={isLoading || isInitializing || !task.trim()}
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
                    <p
                        className={`char-counter text-xs mt-1 text-right${task.length >= MAX_INPUT_CHARS * 0.9 ? ' char-counter-warn' : ''}`}
                        style={{ opacity: task ? 1 : 0 }}
                    >
                        {task.length}/{MAX_INPUT_CHARS}
                    </p>
                </div>
        </div>
    );
};

export default InitialTaskInput;
