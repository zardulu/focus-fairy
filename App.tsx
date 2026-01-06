import React, { useState, useEffect, useRef, useCallback } from 'react';
import InitialTaskInput from './components/InitialTaskInput';
import ChatInterface from './components/ChatInterface';
import { ChatMessage } from './types';
import { initializeChat, getInitialResponse, continueChat, generateCheckinMessage, getCurrentTask, AIProvider, ReminderConfig } from './services/aiService';

const DEFAULT_CHECKIN_MINUTES = 15;

const PROVIDERS: { id: AIProvider; name: string; description: string }[] = [
    { id: 'gemini', name: 'Gemini', description: 'Direct API (gemini-2.5-flash-lite)' },
    { id: 'openrouter', name: 'OpenRouter', description: 'Gemini 2.5 Flash (via OpenRouter)' },
    { id: 'groq', name: 'Groq', description: 'Fast Llama 3.1 8B' },
];

const App: React.FC = () => {
    const [task, setTask] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
    const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
    const [selectedProvider, setSelectedProvider] = useState<AIProvider>('gemini');
    const [apiKeys, setApiKeys] = useState<Record<AIProvider, string>>({
        gemini: '',
        openrouter: '',
        groq: ''
    });
    const [activeTimer, setActiveTimer] = useState<number | null>(null); // Track active timer minutes
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        // Load saved provider and keys
        const savedProvider = localStorage.getItem('ai_provider') as AIProvider;
        if (savedProvider) {
            setSelectedProvider(savedProvider);
        }
        
        setApiKeys({
            gemini: localStorage.getItem('gemini_api_key') || '',
            openrouter: localStorage.getItem('openrouter_api_key') || '',
            groq: localStorage.getItem('groq_api_key') || ''
        });

        if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(setNotificationPermission);
        } else if ('Notification' in window) {
            setNotificationPermission(Notification.permission);
        }
    }, []);

    const handleSaveSettings = () => {
        localStorage.setItem('ai_provider', selectedProvider);
        localStorage.setItem('gemini_api_key', apiKeys.gemini);
        localStorage.setItem('openrouter_api_key', apiKeys.openrouter);
        localStorage.setItem('groq_api_key', apiKeys.groq);
        setShowApiKeyModal(false);
    };

    // Prevent concurrent API calls
    const isGeneratingRef = useRef<boolean>(false);
    const timeoutRef = useRef<number | null>(null);

    // Send a single check-in (used by both one-time and recurring)
    const sendCheckin = useCallback(async (fallbackTask: string) => {
        if (isGeneratingRef.current) {
            console.log(`🔔 Skipped: already generating a check-in message`);
            return;
        }
        
        isGeneratingRef.current = true;
        
        try {
            console.log(`🔔 Generating check-in message...`);
            const taskForCheckin = getCurrentTask() || fallbackTask;
            const checkinMessage = await generateCheckinMessage(taskForCheckin);
            
            console.log(`🔔 Check-in message: ${checkinMessage}`);
            
            // Show browser notification if permission granted
            if (Notification.permission === 'granted') {
                new Notification('Focus Fairy Check-in ✨', { 
                    body: checkinMessage,
                    icon: '/fairy.svg',
                    requireInteraction: true
                });
            }
            
            // Add message to chat
            setMessages(prev => [...prev, { sender: 'ai', text: `🔔 ${checkinMessage}` }]);
            console.log(`🔔 Check-in complete!`);
        } catch (error) {
            console.error(`🔔 Check-in error:`, error);
        } finally {
            isGeneratingRef.current = false;
        }
    }, []);

    // One-time reminder (setTimeout) - for explicit user requests
    const setOneTimeReminder = useCallback((minutes: number, fallbackTask: string) => {
        // Clear any existing timers
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        
        const milliseconds = minutes * 60 * 1000;
        const timeDisplay = minutes >= 1 ? `${minutes} minute(s)` : `${Math.round(minutes * 60)} seconds`;
        
        console.log(`🔔 One-time reminder set for ${timeDisplay} (${milliseconds}ms)`);
        setActiveTimer(minutes);
        
        const notifStatus = Notification.permission === 'granted' 
            ? '' 
            : ' (⚠️ Enable notifications in your browser for alerts!)';
        setMessages(prev => [...prev, { 
            sender: 'ai', 
            text: `⏰ Got it! I'll remind you in ${timeDisplay}.${notifStatus}` 
        }]);

        timeoutRef.current = window.setTimeout(async () => {
            await sendCheckin(fallbackTask);
            setActiveTimer(null); // Clear timer state after firing
            console.log(`🔔 One-time reminder complete, timer cleared.`);
        }, milliseconds);
    }, [sendCheckin]);

    // Recurring check-in (setInterval) - for default periodic check-ins
    const startRecurringCheckin = useCallback((minutes: number, fallbackTask: string) => {
        // Clear any existing timers
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        
        const milliseconds = minutes * 60 * 1000;
        const timeDisplay = minutes >= 1 ? `${minutes} minute(s)` : `${Math.round(minutes * 60)} seconds`;
        
        console.log(`🔔 Recurring check-in set for every ${timeDisplay} (${milliseconds}ms)`);
        console.log(`🔔 Notification permission: ${Notification.permission}`);
        setActiveTimer(minutes);

        intervalRef.current = window.setInterval(async () => {
            await sendCheckin(fallbackTask);
        }, milliseconds);
    }, [sendCheckin]);


    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    // Handle reminder configuration from AI tool calls
    const handleReminderConfig = useCallback((reminder: ReminderConfig | null, fallbackTask: string) => {
        if (!reminder) {
            console.log('📋 No reminder configured');
            return;
        }
        
        if (notificationPermission !== 'granted') {
            console.log('📋 Notifications not granted, skipping reminder');
            setMessages(prev => [...prev, { 
                sender: 'ai', 
                text: `⚠️ Enable notifications in your browser to get check-in reminders!` 
            }]);
            return;
        }
        
        console.log(`📋 Reminder configured:`, reminder);
        
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
    }, [notificationPermission, setOneTimeReminder, startRecurringCheckin]);

    const handleTaskSubmit = async (newTask: string) => {
        if (!newTask.trim()) return;
        setTask(newTask);
        setIsLoading(true);

        try {
            initializeChat();
            const { text, reminder } = await getInitialResponse(newTask);
            // Include both the user's initial task AND the AI response
            setMessages([
                { sender: 'user', text: newTask },
                { sender: 'ai', text }
            ]);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(reminder, newTask);
            
        } catch (error) {
            console.error("Failed to initialize chat:", error);
            setMessages([
                { sender: 'user', text: newTask },
                { sender: 'ai', text: "Sorry, I couldn't connect. Please check your API key and refresh." }
            ]);
            
            // Fallback: start default recurring check-in on error
            if (notificationPermission === 'granted') {
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

        try {
            const { text, reminder } = await continueChat(userMessage);
            setMessages(prev => [...prev, { sender: 'ai', text }]);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(reminder, task);
            
        } catch (error) {
            console.error("Failed to send message:", error);
            setMessages(prev => [...prev, { sender: 'ai', text: "I'm having trouble responding right now. Let's try again in a moment." }]);
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
                        className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl"
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
                                    <div>
                                        <div className="font-medium text-sm" style={{ color: 'var(--text-dark)' }}>
                                            {provider.name}
                                            {apiKeys[provider.id] && (
                                                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>✓ Key saved</span>
                                            )}
                                        </div>
                                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                            {provider.description}
                                        </div>
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
                            {selectedProvider === 'openrouter' && (
                                <>Get your key from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">OpenRouter</a></>
                            )}
                            {selectedProvider === 'groq' && (
                                <>Get your key from <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline">Groq Console</a></>
                            )}
                        </p>

                        {/* Notification Test Section */}
                        <div className="border-t pt-4 mb-4" style={{ borderColor: 'var(--border-light)' }}>
                            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                                Notifications: {Notification.permission === 'granted' ? '✅ Enabled' : Notification.permission === 'denied' ? '❌ Blocked' : '⚠️ Not enabled'}
                            </p>
                            <div className="flex gap-2">
                                {Notification.permission !== 'granted' && (
                                    <button 
                                        onClick={() => Notification.requestPermission().then(setNotificationPermission)}
                                        className="px-3 py-1.5 text-xs rounded-full border"
                                        style={{ borderColor: 'var(--border-light)', color: 'var(--text-dark)' }}
                                    >
                                        Enable Notifications
                                    </button>
                                )}
                                <button 
                                    onClick={() => {
                                        if (Notification.permission === 'granted') {
                                            new Notification('Focus Fairy Test ✨', { 
                                                body: 'Notifications are working! 🎉',
                                                icon: '/fairy.svg'
                                            });
                                            console.log('🔔 Test notification sent!');
                                        } else {
                                            alert('Please enable notifications first!');
                                        }
                                    }}
                                    className="px-3 py-1.5 text-xs rounded-full border"
                                    style={{ borderColor: 'var(--border-light)', color: 'var(--text-dark)' }}
                                >
                                    Test Notification
                                </button>
                            </div>
                        </div>

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
