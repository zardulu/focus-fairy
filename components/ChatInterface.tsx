import React, { useState, useEffect } from 'react';
import type { ChatMessage } from '../types';

interface ChatInterfaceProps {
    task: string;
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
    streamingText?: string;
    streamingComplete?: boolean;
    onApiKeyClick?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ task, messages, onSendMessage, isLoading, streamingText = '', streamingComplete = false, onApiKeyClick }) => {
    const [inputMessage, setInputMessage] = useState('');
    const [viewOffset, setViewOffset] = useState(0); // 0 = latest, negative = older

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
    
    // Get AI message - but when streaming on latest view, don't show the last message to avoid duplication
    const aiMessage = showLiveAiText
        ? null  // Don't show previous AI message while streaming
        : isViewingLatest
            ? aiMessages[aiMessages.length - 1] || null
            : aiMessages[currentPairIndex] || null;

    const displayedAiText = showLiveAiText
        ? streamingText
        : aiMessage?.text || "Hi! I'm here to help you stay focused ✨ Tell me what you're working on, and I'll guide you through it step by step.";

    const waitingForAiResponse = hasUserMessages && userMessage && !aiMessage && !showLiveAiText;
    const showSparkleIndicator = ((isLoading && isViewingLatest) || waitingForAiResponse) && !showLiveAiText;

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
                    className="font-title text-3xl sm:text-4xl font-semibold italic mb-0"
                    style={{ color: 'var(--text-dark)' }}
                >
                    Focus Fairy ✨
                </h1>

                {/* Chat View Container */}
                <div className="chat-view-wrapper w-full mb-0">
                    <div className="chat-pair-container">
                        {/* User Message at Top - plain text, slides up */}
                        {userMessage ? (
                            <div className="user-message-row">
                                <p
                                    className="user-message-text animate-slideUp"
                                    key={`user-${currentPairIndex}`}
                                >
                                    {userMessage.text}
                                </p>
                            </div>
                        ) : null}

                        {/* AI Message at Bottom - with fairy and bubble */}
                        <div className="ai-message-row gap-0 sm:gap-0">
                            <div className="fairy-container animate-float flex-shrink-0">
                                <img src="/fairy.svg" alt="Focus Fairy" />
                            </div>
                            {showSparkleIndicator ? (
                                <div className="sparkle-loading-wrapper animate-fadeIn flex-1 min-w-0">
                                    <AISparkleIndicator />
                                </div>
                            ) : (
                                <div className="speech-bubble-ai animate-fadeIn flex-1 min-w-0">
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-dark)' }}>
                                        {displayedAiText}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Navigation arrows - fixed position */}
                    {hasUserMessages ? (
                        <div className="nav-arrows">
                            <button
                                onClick={scrollUp}
                                className="nav-arrow"
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

                {/* Input Form */}
                <div className="w-full input-form-container" style={{ paddingLeft: '140px' }}>
                    <form
                        onSubmit={handleSendMessage}
                        className="flex items-center gap-2 sm:gap-3 w-full"
                    >
                        <input
                            type="text"
                            value={inputMessage}
                            onChange={handleInputChange}
                            placeholder=""
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
                    <p className="text-xs mt-1 text-right" style={{
                        color: currentCharCount >= MAX_INPUT_CHARS ? 'var(--accent-pink)' : 'var(--text-muted)',
                        opacity: inputMessage ? 1 : 0
                    }}>
                        {currentCharCount}/{MAX_INPUT_CHARS}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ChatInterface;
