import React, { useState, useEffect, useRef, useCallback } from 'react';
import InitialTaskInput from './components/InitialTaskInput';
import ChatInterface from './components/ChatInterface';
import { ChatMessage } from './types';
import { initializeChat, getInitialResponse, continueChat, generateCheckinMessage, AIProvider } from './services/aiService';

const DEFAULT_CHECKIN_MINUTES = 15;

const PROVIDERS: { id: AIProvider; name: string; description: string }[] = [
    { id: 'gemini', name: 'Gemini', description: 'Google AI (gemini-2.5-flash)' },
    { id: 'openrouter', name: 'OpenRouter', description: 'Mistral 7B (cheap)' },
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

    const startCheckinTimer = useCallback((minutes: number, currentTask: string) => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        
        console.log(`Setting check-in timer for ${minutes} minutes.`);

        intervalRef.current = window.setInterval(async () => {
            if (document.hidden) {
                const checkinMessage = await generateCheckinMessage(currentTask);
                new Notification('Focus Fairy Check-in ✨', { 
                    body: checkinMessage,
                    icon: '/fairy.svg' 
                });
                setMessages(prev => [...prev, { sender: 'ai', text: `🔔 *Check-in:* ${checkinMessage}` }]);
            }
        }, minutes * 60 * 1000);
    }, []);


    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    const handleTaskSubmit = async (newTask: string) => {
        if (!newTask.trim()) return;
        setTask(newTask);
        setIsLoading(true);

        try {
            initializeChat();
            const { text, interval } = await getInitialResponse(newTask);
            // Include both the user's initial task AND the AI response
            setMessages([
                { sender: 'user', text: newTask },
                { sender: 'ai', text }
            ]);

            if (notificationPermission === 'granted') {
                const checkinTime = interval ?? DEFAULT_CHECKIN_MINUTES;
                startCheckinTimer(checkinTime, newTask);
            }
        } catch (error) {
            console.error("Failed to initialize chat:", error);
            setMessages([
                { sender: 'user', text: newTask },
                { sender: 'ai', text: "Sorry, I couldn't connect. Please check your API key and refresh." }
            ]);
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
            const { text, interval } = await continueChat(userMessage);
            setMessages(prev => [...prev, { sender: 'ai', text }]);

            if (interval && notificationPermission === 'granted') {
                startCheckinTimer(interval, task);
            }
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
