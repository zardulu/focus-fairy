
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Chat } from '@google/genai';
import InitialTaskInput from './components/InitialTaskInput';
import ChatInterface from './components/ChatInterface';
import { ChatMessage } from './types';
import { createChatSession, getInitialResponse, continueChat, generateCheckinMessage } from './services/geminiService';

const DEFAULT_CHECKIN_MINUTES = 15;

const App: React.FC = () => {
    const [task, setTask] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
    const chatRef = useRef<Chat | null>(null);
    const intervalRef = useRef<number | null>(null);

    useEffect(() => {
        if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(setNotificationPermission);
        } else if ('Notification' in window) {
            setNotificationPermission(Notification.permission);
        }
    }, []);

    const startCheckinTimer = useCallback((minutes: number, currentTask: string) => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        
        console.log(`Setting check-in timer for ${minutes} minutes.`);

        intervalRef.current = window.setInterval(async () => {
            if (document.hidden) { // Only send notification if tab is not active
                const checkinMessage = await generateCheckinMessage(currentTask);
                new Notification('FocusFlow Check-in ✨', { 
                    body: checkinMessage,
                    icon: '/favicon.ico' 
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
            const newChat = createChatSession();
            chatRef.current = newChat;

            const { text, interval } = await getInitialResponse(newChat, newTask);
            setMessages([{ sender: 'ai', text }]);

            if (notificationPermission === 'granted') {
                const checkinTime = interval ?? DEFAULT_CHECKIN_MINUTES;
                startCheckinTimer(checkinTime, newTask);
            }
        } catch (error) {
            console.error("Failed to initialize chat:", error);
            setMessages([{ sender: 'ai', text: "Sorry, I couldn't connect to the assistant. Please check your connection or API key and refresh." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (userMessage: string) => {
        if (!userMessage.trim() || !chatRef.current || !task) return;

        const newMessages: ChatMessage[] = [...messages, { sender: 'user', text: userMessage }];
        setMessages(newMessages);
        setIsLoading(true);

        try {
            const { text, interval } = await continueChat(chatRef.current, userMessage);
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

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 font-sans bg-gradient-to-br from-gray-900 via-gray-800 to-indigo-900">
            {task ? (
                <ChatInterface
                    task={task}
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isLoading={isLoading}
                />
            ) : (
                <InitialTaskInput onTaskSubmit={handleTaskSubmit} isLoading={isLoading} />
            )}
        </div>
    );
};

export default App;
