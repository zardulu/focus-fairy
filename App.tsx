import React, { useState, useEffect, useRef, useCallback } from 'react';
import InitialTaskInput from './components/InitialTaskInput';
import ChatInterface from './components/ChatInterface';
import { ChatMessage } from './types';
import { initializeChat, generateCheckinMessage, getCurrentTask, AIProvider, ReminderConfig, streamInitialResponse, streamContinueChat } from './services/aiService';

const DEFAULT_CHECKIN_MINUTES = 15;

const PROVIDERS: { id: AIProvider; name: string }[] = [
    { id: 'gemini', name: 'Gemini' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'groq', name: 'Groq' },
];

const App: React.FC = () => {
    const [task, setTask] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [streamingText, setStreamingText] = useState<string>('');
    const [streamingComplete, setStreamingComplete] = useState<boolean>(false);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
    const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
    const [selectedProvider, setSelectedProvider] = useState<AIProvider>('gemini');
    const [apiKeys, setApiKeys] = useState<Record<AIProvider, string>>({
        gemini: '',
        openai: '',
        openrouter: '',
        groq: ''
    });
    const [activeTimer, setActiveTimer] = useState<number | null>(null); // Track active timer minutes
    const workerRef = useRef<Worker | null>(null);
    const currentTaskRef = useRef<string>(''); // Store current task for worker callback

    const appendLocalAiMessageWithStreaming = useCallback(async (text: string) => {
        setStreamingText('');
        setStreamingComplete(false);

        for (let i = 0; i < text.length; i++) {
            setStreamingText(text.slice(0, i + 1));
            await new Promise(resolve => setTimeout(resolve, 15));
        }

        setStreamingComplete(true);
        setMessages(prev => [...prev, { sender: 'ai', text }]);
        setStreamingText('');
        setStreamingComplete(false);
    }, []);

    useEffect(() => {
        // Load saved provider and keys
        const savedProvider = localStorage.getItem('ai_provider') as AIProvider;
        if (savedProvider) {
            setSelectedProvider(savedProvider);
        }

        setApiKeys({
            gemini: (localStorage.getItem('gemini_api_key') || '').trim(),
            openai: (localStorage.getItem('openai_api_key') || '').trim(),
            openrouter: (localStorage.getItem('openrouter_api_key') || '').trim(),
            groq: (localStorage.getItem('groq_api_key') || '').trim(),
        });

        if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(setNotificationPermission);
        } else if ('Notification' in window) {
            setNotificationPermission(Notification.permission);
        }
    }, []);

    const handleSaveSettings = () => {
        localStorage.setItem('ai_provider', selectedProvider);
        localStorage.setItem('gemini_api_key', apiKeys.gemini.trim());
        localStorage.setItem('openai_api_key', apiKeys.openai.trim());
        localStorage.setItem('openrouter_api_key', apiKeys.openrouter.trim());
        localStorage.setItem('groq_api_key', apiKeys.groq.trim());
        setShowApiKeyModal(false);
    };

    // Prevent concurrent API calls
    const isGeneratingRef = useRef<boolean>(false);
    const timerTypeRef = useRef<'one-time' | 'recurring' | null>(null);

    // Send a single check-in (used by both one-time and recurring)
    const sendCheckin = useCallback(async (fallbackTask: string) => {
        if (isGeneratingRef.current) {
            return;
        }

        isGeneratingRef.current = true;

        try {
            const taskForCheckin = getCurrentTask() || fallbackTask;
            const checkinMessage = await generateCheckinMessage(taskForCheckin);

            // Show browser notification if permission granted
            if (Notification.permission === 'granted') {
                new Notification('Focus Fairy Check-in ✨', {
                    body: checkinMessage,
                    icon: '/fairy.svg'
                });
            }

            // Add message to chat
            setMessages(prev => [...prev, { sender: 'ai', text: `🔔 ${checkinMessage}` }]);
        } catch {
            /* check-in message failed; chat already handles missing keys elsewhere */
        } finally {
            isGeneratingRef.current = false;
        }
    }, []);

    // One-time reminder - using Web Worker for reliable background execution
    const setOneTimeReminder = useCallback((minutes: number, fallbackTask: string) => {
        // Store task for callback
        currentTaskRef.current = fallbackTask;
        timerTypeRef.current = 'one-time';

        const milliseconds = minutes * 60 * 1000;
        const timeDisplay = minutes >= 1 ? `${minutes} minute(s)` : `${Math.round(minutes * 60)} seconds`;

        setActiveTimer(minutes);

        const notifStatus = Notification.permission === 'granted'
            ? ''
            : ' (⚠️ Enable notifications in your browser for alerts!)';
        setMessages(prev => [...prev, {
            sender: 'ai',
            text: `⏰ Got it! I'll remind you in ${timeDisplay}.${notifStatus}`
        }]);

        // Start worker timer
        if (workerRef.current) {
            workerRef.current.postMessage({ action: 'start', milliseconds, type: 'one-time' });
        }
    }, []);

    // Recurring check-in - using Web Worker for reliable background execution
    const startRecurringCheckin = useCallback((minutes: number, fallbackTask: string) => {
        // Store task for callback
        currentTaskRef.current = fallbackTask;
        timerTypeRef.current = 'recurring';

        const milliseconds = minutes * 60 * 1000;

        setActiveTimer(minutes);

        // Start worker timer
        if (workerRef.current) {
            workerRef.current.postMessage({ action: 'start', milliseconds, type: 'recurring' });
        }
    }, []);

    // Initialize Web Worker and handle messages
    useEffect(() => {
        // Create worker
        workerRef.current = new Worker('/timer-worker.js');

        // Handle timer ticks from worker
        workerRef.current.onmessage = async (e) => {
            if (e.data.type === 'tick') {
                await sendCheckin(currentTaskRef.current);

                // Clear timer state for one-time reminders
                if (timerTypeRef.current === 'one-time') {
                    setActiveTimer(null);
                    timerTypeRef.current = null;
                }
            }
        };

        return () => {
            if (workerRef.current) {
                workerRef.current.postMessage({ action: 'stop' });
                workerRef.current.terminate();
            }
        };
    }, [sendCheckin]);

    // Handle reminder configuration from AI tool calls
    const handleReminderConfig = useCallback((reminder: ReminderConfig | null, fallbackTask: string) => {
        if (!reminder) {
            return;
        }

        // Check browser API directly instead of React state (which can be stale)
        const currentPermission = Notification.permission;

        if (currentPermission !== 'granted') {
            setMessages(prev => [...prev, {
                sender: 'ai',
                text: `⚠️ Enable notifications in your browser to get check-in reminders!`
            }]);
            return;
        }

        const timeDisplay = reminder.minutes >= 1
            ? `${reminder.minutes} minute(s)`
            : `${Math.round(reminder.minutes * 60)} seconds`;

        if (reminder.type === 'one-time') {
            setOneTimeReminder(reminder.minutes, fallbackTask);
        } else {
            // Add a message for recurring check-ins
            setMessages(prev => [...prev, {
                sender: 'ai',
                text: `✨ I'll check in with you every ${timeDisplay}. Let's do this!`
            }]);
            startRecurringCheckin(reminder.minutes, fallbackTask);
        }
    }, [setOneTimeReminder, startRecurringCheckin]);

    const handleTaskSubmit = async (newTask: string) => {
        if (!newTask.trim()) return;
        setTask(newTask);

        // Immediately show the user's message before waiting for AI response
        setMessages([{ sender: 'user', text: newTask }]);
        setIsLoading(true);
        setStreamingText('');
        setStreamingComplete(false);

        try {
            initializeChat();
            
            // Stream text with callback for real-time updates
            const onChunk = (text: string) => {
                setStreamingText(text);
            };
            
            const { text, reminder } = await streamInitialResponse(newTask, onChunk);

            // Mark streaming as complete (keeps showing last text until we add message)
            setStreamingComplete(true);
            
            // Now add the final message
            setMessages(prev => [...prev, { sender: 'ai', text }]);
            setStreamingText('');
            setStreamingComplete(false);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(reminder, newTask);

        } catch {
            await appendLocalAiMessageWithStreaming("To use Focus Fairy, please add your own API key in Settings. Don't worry, you can use free-tier keys!");

            // Fallback: start default recurring check-in on error
            if (Notification.permission === 'granted') {
                startRecurringCheckin(DEFAULT_CHECKIN_MINUTES, newTask);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (userMessage: string) => {
        if (!userMessage.trim() || !task) return;

        const newMessages: ChatMessage[] = [...messages, { sender: 'user', text: userMessage }];
        setMessages(newMessages);
        setIsLoading(true);
        setStreamingText('');
        setStreamingComplete(false);

        try {
            // Stream text with callback for real-time updates
            const onChunk = (text: string) => {
                setStreamingText(text);
            };
            
            const { text, reminder } = await streamContinueChat(userMessage, onChunk);
            
            // Mark streaming as complete (keeps showing last text until we add message)
            setStreamingComplete(true);
            
            // Now add the final message
            setMessages(prev => [...prev, { sender: 'ai', text }]);
            setStreamingText('');
            setStreamingComplete(false);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(reminder, task);

        } catch {
            await appendLocalAiMessageWithStreaming("I'm having trouble responding right now. Let's try again in a moment.");
        } finally {
            setIsLoading(false);
        }
    };

    const currentProviderHasKey = apiKeys[selectedProvider]?.trim() !== '';

    return (
        <>
            {task ? (
                <ChatInterface
                    task={task}
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isLoading={isLoading}
                    streamingText={streamingText}
                    streamingComplete={streamingComplete}
                    onApiKeyClick={() => setShowApiKeyModal(true)}
                />
            ) : (
                <InitialTaskInput
                    onTaskSubmit={handleTaskSubmit}
                    isLoading={isLoading}
                    onApiKeyClick={() => setShowApiKeyModal(true)}
                />
            )}

            {/* API Key Modal */}
            {showApiKeyModal && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
                    onClick={() => setShowApiKeyModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl p-4 sm:p-6 max-w-md w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="font-title text-2xl font-semibold mb-4" style={{ color: 'var(--text-dark)' }}>
                            AI Provider Settings
                        </h2>

                        {/* Provider Selection */}
                        <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                            Select AI Provider
                        </p>
                        <div className="flex flex-col gap-2 mb-4">
                            {PROVIDERS.map((provider) => (
                                <button
                                    key={provider.id}
                                    onClick={() => setSelectedProvider(provider.id)}
                                    className="flex items-center gap-3 p-3 rounded-xl border transition-all text-left"
                                    style={{
                                        borderColor: selectedProvider === provider.id ? 'var(--accent-pink)' : 'var(--border-light)',
                                        backgroundColor: selectedProvider === provider.id ? 'var(--accent-pink-light)' : 'white'
                                    }}
                                >
                                    <div
                                        className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                                        style={{ borderColor: selectedProvider === provider.id ? 'var(--accent-pink)' : 'var(--border-light)' }}
                                    >
                                        {selectedProvider === provider.id && (
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: 'var(--accent-pink)' }}
                                            />
                                        )}
                                    </div>
                                    <div className="font-medium text-sm" style={{ color: 'var(--text-dark)' }}>
                                        {provider.name}
                                        {apiKeys[provider.id] && (
                                            <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>✓ Key saved</span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* API Key Input */}
                        <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                            {PROVIDERS.find(p => p.id === selectedProvider)?.name} API Key
                        </p>
                        <input
                            type="password"
                            value={apiKeys[selectedProvider]}
                            onChange={(e) => setApiKeys(prev => ({ ...prev, [selectedProvider]: e.target.value }))}
                            placeholder={`Enter your ${PROVIDERS.find(p => p.id === selectedProvider)?.name} API key...`}
                            className="input-field w-full mb-4"
                        />

                        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                            {selectedProvider === 'gemini' && (
                                <>Get your key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline">Google AI Studio</a></>
                            )}
                            {selectedProvider === 'openai' && (
                                <>Get your key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">OpenAI Platform</a></>
                            )}
                            {selectedProvider === 'openrouter' && (
                                <>Get your key from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">OpenRouter</a></>
                            )}
                            {selectedProvider === 'groq' && (
                                <>Get your key from <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline">Groq Console</a></>
                            )}
                        </p>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowApiKeyModal(false)}
                                className="px-4 py-2 text-sm rounded-full"
                                style={{ color: 'var(--text-muted)' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveSettings}
                                className="btn-dark"
                                disabled={!currentProviderHasKey}
                                style={{ opacity: currentProviderHasKey ? 1 : 0.5 }}
                            >
                                Save Settings
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default App;
