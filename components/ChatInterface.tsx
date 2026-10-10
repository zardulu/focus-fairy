import React, { useState, useEffect } from 'react';
import type { ChatMessage } from '../types';
import StreamingText from './StreamingText';

interface ChatInterfaceProps {
    task: string;
    currentTask: string;
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
    streamingText?: string;
    streamingComplete?: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ task, currentTask, messages, onSendMessage, isLoading, streamingText = '', streamingComplete = false }) => {
    const [inputMessage, setInputMessage] = useState('');
    const [viewOffset, setViewOffset] = useState(0); // 0 = latest, negative = older
    const [isTaskListOpen, setIsTaskListOpen] = useState(true);

    // Character limit for input
    const MAX_INPUT_CHARS = 280;

    // Separate user and AI messages for easier pairing
    const userMessages = messages.filter(m => m.sender === 'user');
    const aiMessages = messages.filter(m => m.sender === 'ai');

    // Reset view to latest when new messages arrive
    useEffect(() => {
        setViewOffset(0);
    }, [messages.length]);

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputMessage.trim() && !isLoading) {
            onSendMessage(inputMessage.trim());
            setInputMessage('');
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const text = e.target.value;
        if (text.length <= MAX_INPUT_CHARS) {
            setInputMessage(text);
        }
    };

    const currentCharCount = inputMessage.length;

    // Navigate to earlier messages (scroll up = more negative offset)
    const scrollUp = () => {
        const maxOffset = -(userMessages.length - 1);
        setViewOffset(prev => Math.max(maxOffset, prev - 1));
    };

    // Navigate to later messages (scroll down = less negative offset)
    const scrollDown = () => {
        setViewOffset(prev => Math.min(0, prev + 1));
    };

    const canScrollUp = userMessages.length > 1 && viewOffset > -(userMessages.length - 1);
    const canScrollDown = viewOffset < 0;

    const AISparkleIndicator = () => (
        <div className="sparkle-loading" aria-label="Focus Fairy is thinking" role="status">
            <span className="sparkle sparkle-large">✦</span>
            <span className="sparkle sparkle-small">✦</span>
            <span className="sparkle sparkle-medium">✦</span>
        </div>
    );

    // Calculate current pair index (0 = first pair, higher = later pairs)
    // viewOffset 0 = latest pair, -1 = second to last, etc.
    const latestPairIndex = userMessages.length - 1;
    const currentPairIndex = Math.max(0, latestPairIndex + viewOffset);

    // Get current pair to display
    // User messages and AI messages are paired 1:1 (user[0] pairs with ai[0], etc.)
    const hasUserMessages = userMessages.length > 0;
    const userMessage = hasUserMessages ? userMessages[currentPairIndex] : null;

    // For AI messages: at the latest view (offset 0), always show the most recent AI message
    // This handles check-in messages that don't have a corresponding user message
    const isViewingLatest = viewOffset === 0;
    
    // Show typing indicator when waiting for AI response, but not when streaming
    const isStreaming = isLoading && streamingText.length > 0;
    const showStreamingText = isStreaming || streamingComplete;
    const showLiveAiText = isViewingLatest && showStreamingText;
    const waitingForLatestAiResponse = isLoading && isViewingLatest && !showLiveAiText;
    
    // Get AI message - but while waiting/streaming on latest view, hide the previous AI turn immediately.
    const aiMessage = showLiveAiText || waitingForLatestAiResponse
        ? null
        : isViewingLatest
            ? aiMessages[aiMessages.length - 1] || null
            : aiMessages[currentPairIndex] || null;

    const displayedAiText = showLiveAiText
        ? streamingText
        : aiMessage?.text || "Hi! I'm here to help you stay focused ✨ Tell me what you're working on, and I'll guide you through it step by step.";

    const waitingForAiResponse = hasUserMessages && userMessage && !aiMessage && !showLiveAiText;
    const showSparkleIndicator = ((isLoading && isViewingLatest) || waitingForAiResponse) && !showLiveAiText;

    const showStreamParticles =
        isLoading && streamingText.length > 0 && !streamingComplete;
    const displayedCurrentTask = currentTask || task;
    const taskListForMessage = aiMessage?.taskListSnapshot || [];
    const currentTaskForMessage = aiMessage?.currentTaskSnapshot || displayedCurrentTask;
    const showTaskListForMessage = Boolean(aiMessage?.showTaskList && taskListForMessage.length > 0 && !showLiveAiText);
    const showTaskActionStatus = Boolean(aiMessage?.showTaskActionStatus && !showLiveAiText);
    const taskActionStatusText = aiMessage?.taskActionStatusText || 'Updated';

    return (
        <div className="focus-stage chat-focus-stage w-full">
            <div className="chat-view-wrapper w-full mb-0">
                    <div className="chat-pair-container">
                        {/* User Message at Top - plain text, slides up */}
                        {userMessage ? (
                            <div className="user-message-row">
                                <p
                                    className="user-message-text animate-slideUp custom-scrollbar"
                                    key={`user-${currentPairIndex}`}
                                >
                                    {userMessage.text}
                                </p>
                            </div>
                        ) : null}

                        {/* AI Message at Bottom - with fairy and bubble */}
                        <div className="ai-message-row gap-0 sm:gap-0">
                            <div className={`fairy-container animate-float flex-shrink-0${isLoading ? ' fairy-thinking' : ''}`}>
                                <img src="/fairy.svg" alt="Focus Fairy" />
                            </div>
                            {showSparkleIndicator ? (
                                <div className="sparkle-loading-wrapper animate-fadeIn flex-1 min-w-0">
                                    <AISparkleIndicator />
                                </div>
                            ) : (
                                <div className="speech-bubble-ai animate-fadeIn custom-scrollbar flex-1 min-w-0">
                                    <StreamingText
                                        text={displayedAiText}
                                        particlesActive={showStreamParticles && showLiveAiText}
                                        className="text-sm leading-relaxed"
                                        style={{ color: 'var(--text-dark)' }}
                                    />
                                </div>
                            )}
                        </div>

                        {showTaskActionStatus ? (
                            <section
                                className="task-list-container w-full animate-fadeIn"
                                aria-label="Task and timer status"
                            >
                                <div className="task-action-status">
                                    <span className="task-action-status-check" aria-hidden="true">✓</span>
                                    <span>{taskActionStatusText}</span>
                                </div>
                            </section>
                        ) : null}

                        {showTaskListForMessage ? (
                            <section
                                className="task-list-container w-full animate-fadeIn"
                                aria-label="Current session tasks"
                            >
                                <div
                                    className="task-list-panel rounded-xl px-3 py-2 border"
                                    style={{
                                        borderColor: 'var(--accent-pink)',
                                        backgroundColor: 'var(--bg-warm)'
                                    }}
                                >
                                    <button
                                        type="button"
                                        className="w-full flex items-center justify-between gap-3 text-left"
                                        onClick={() => setIsTaskListOpen(prev => !prev)}
                                        aria-expanded={isTaskListOpen}
                                        aria-controls="session-task-list"
                                    >
                                        <span className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
                                            Current: <span className="font-medium" style={{ color: 'var(--text-dark)' }}>{currentTaskForMessage}</span>
                                        </span>
                                        <span className="text-xs flex-shrink-0 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                            {taskListForMessage.length} task{taskListForMessage.length === 1 ? '' : 's'}
                                            <svg
                                                className={`task-list-chevron${isTaskListOpen ? '' : ' task-list-chevron-closed'}`}
                                                width="10"
                                                height="7"
                                                viewBox="0 0 12 8"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                                aria-hidden="true"
                                            >
                                                <path d="M1 6L6 1L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </span>
                                    </button>
                                    <div
                                        id="session-task-list"
                                        hidden={!isTaskListOpen}
                                    >
                                        <ul className="flex flex-col gap-1.5 mt-2 pt-2 border-t" style={{ borderColor: 'var(--accent-pink)' }}>
                                            {taskListForMessage.map(sessionTask => {
                                                const isCurrent = sessionTask.title === currentTaskForMessage;

                                                return (
                                                    <li
                                                        key={sessionTask.id}
                                                        className="text-xs leading-snug flex items-start gap-2"
                                                        style={{ color: isCurrent ? 'var(--text-dark)' : 'var(--text-muted)' }}
                                                        title={sessionTask.title}
                                                    >
                                                        <span aria-hidden="true" className="mt-0.5">
                                                            {isCurrent ? '•' : '○'}
                                                        </span>
                                                        <span className={isCurrent ? 'font-medium' : ''}>{sessionTask.title}</span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                </div>
                            </section>
                        ) : null}

                    </div>

                    {/* Navigation arrows - fixed position */}
                    {hasUserMessages ? (
                        <div className="nav-arrows">
                            <button
                                onClick={scrollUp}
                                className="nav-arrow"
                                aria-label="Show earlier messages"
                                disabled={!canScrollUp}
                                style={{ opacity: canScrollUp ? 1 : 0.3, cursor: canScrollUp ? 'pointer' : 'default' }}
                            >
                                <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1 6L6 1L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                            <button
                                onClick={scrollDown}
                                className="nav-arrow"
                                aria-label="Show later messages"
                                disabled={!canScrollDown}
                                style={{ opacity: canScrollDown ? 1 : 0.3, cursor: canScrollDown ? 'pointer' : 'default' }}
                            >
                                <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1 2L6 7L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        </div>
                    ) : null}
                </div>

                <div className="w-full input-form-container" style={{ paddingLeft: '140px' }}>
                    <form
                        onSubmit={handleSendMessage}
                        className="flex items-center gap-2 sm:gap-3 w-full"
                    >
                        <input
                            type="text"
                            value={inputMessage}
                            onChange={handleInputChange}
                            placeholder="Reply to your fairy…"
                            className="input-field flex-1"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            className="btn-send"
                            disabled={isLoading || !inputMessage.trim()}
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
                        className={`char-counter text-xs mt-1 text-right${currentCharCount >= MAX_INPUT_CHARS * 0.9 ? ' char-counter-warn' : ''}`}
                        style={{ opacity: inputMessage ? 1 : 0 }}
                    >
                        {currentCharCount}/{MAX_INPUT_CHARS}
                    </p>
                </div>
        </div>
    );
};

export default ChatInterface;
