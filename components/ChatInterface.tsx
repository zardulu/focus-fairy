import React, { useState, useEffect } from 'react';
import type { ChatMessage } from '../types';

interface ChatInterfaceProps {
    task: string;
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
    onApiKeyClick?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ task, messages, onSendMessage, isLoading, onApiKeyClick }) => {
    const [inputMessage, setInputMessage] = useState('');
    const [viewOffset, setViewOffset] = useState(0); // 0 = latest, negative = older

    // Word limit for input
    const MAX_INPUT_WORDS = 100;

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
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount <= MAX_INPUT_WORDS) {
            setInputMessage(text);
        }
    };

    const currentWordCount = inputMessage.trim().split(/\s+/).filter(Boolean).length;

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

    const AITypingIndicator = () => (
        <div className="flex items-center gap-1.5 py-2">
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
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
    const aiMessage = isViewingLatest
        ? aiMessages[aiMessages.length - 1] || null  // Always show latest AI message
        : aiMessages[currentPairIndex] || null;      // When scrolling back, use paired index

    // Show typing indicator when waiting for AI response
    const waitingForAiResponse = hasUserMessages && userMessage && !aiMessage;
    const showTypingIndicator = (isLoading && isViewingLatest) || waitingForAiResponse;

    return (
        <div
            className="min-h-screen w-full flex flex-col items-center justify-center p-4 relative"
            style={{ backgroundColor: 'var(--bg-white)' }}
        >
            {/* Top Buttons */}
            <div className="absolute top-6 right-6 flex gap-2">
                <button
                    onClick={() => {
                        console.log('🔔 Testing notification...');
                        console.log('🔔 Notification.permission:', Notification.permission);

                        if (Notification.permission === 'granted') {
                            const notif = new Notification('Focus Fairy Test ✨', {
                                body: 'If you see this, notifications work! 🎉',
                                icon: '/fairy.svg'
                            });
                            console.log('🔔 Notification object:', notif);
                            alert('Notification sent! Check your notification center if you don\'t see a popup.');
                        } else if (Notification.permission === 'denied') {
                            alert('Notifications are BLOCKED. Go to browser settings to enable them for this site.');
                        } else {
                            Notification.requestPermission().then(permission => {
                                console.log('🔔 Permission result:', permission);
                                if (permission === 'granted') {
                                    new Notification('Focus Fairy Test ✨', {
                                        body: 'Notifications enabled! 🎉',
                                        icon: '/fairy.svg'
                                    });
                                }
                            });
                        }
                    }}
                    className="px-3 py-1.5 text-xs rounded-full border"
                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-dark)', backgroundColor: 'white' }}
                >
                    🔔 Test
                </button>
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
                    className="font-title text-4xl font-semibold italic mb-0"
                    style={{ color: 'var(--text-dark)' }}
                >
                    Focus Fairy
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
                        <div className="ai-message-row">
                            <div className="fairy-container animate-float">
                                <img src="/fairy.svg" alt="Focus Fairy" />
                            </div>
                            {showTypingIndicator ? (
                                <div className="speech-bubble-ai animate-fadeIn">
                                    <AITypingIndicator />
                                </div>
                            ) : (
                                <div className="speech-bubble-ai animate-fadeIn" key={`ai-${currentPairIndex}`}>
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-dark)' }}>
                                        {aiMessage?.text || "Hi! I'm here to help you stay focused ✨ Tell me what you're working on, and I'll guide you through it step by step."}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Navigation arrows - fixed position */}
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
                </div>

                {/* Input Form */}
                <div className="w-full input-form-container" style={{ paddingLeft: '140px', paddingRight: '40px' }}>
                    <form
                        onSubmit={handleSendMessage}
                        className="flex items-center gap-3 w-full"
                    >
                        <input
                            type="text"
                            value={inputMessage}
                            onChange={handleInputChange}
                            placeholder=""
                            className="input-field flex-1"
                            disabled={isLoading}
                        />
                        {/* <button
                            type="submit"
                            className="btn-send"
                            disabled={isLoading || !inputMessage.trim()}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button> */}
                    </form>
                    {inputMessage && (
                        <p className="text-xs mt-0 text-right" style={{ color: currentWordCount >= MAX_INPUT_WORDS ? 'var(--accent-pink)' : 'var(--text-muted)' }}>
                            {currentWordCount}/{MAX_INPUT_WORDS} words
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatInterface;
