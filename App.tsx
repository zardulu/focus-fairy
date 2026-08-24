import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import InitialTaskInput from './components/InitialTaskInput';
import ChatInterface from './components/ChatInterface';
import { ChatMessage, SessionTask, AIProvider, ScheduledTask } from './types';
import { initializeChat, generateCheckinMessage, getCurrentTask, ReminderConfig, TaskUpdate, streamInitialResponse, streamContinueChat } from './services/aiService';
import { useAuth } from './contexts/AuthContext';
import * as dbService from './services/dbService';
import { useDailySession, getTodayDateString } from './hooks/useDailySession';
import { ToastContainer, useToasts } from './components/Toasts';

const DEFAULT_CHECKIN_MINUTES = 15;

const PROVIDERS: { id: AIProvider; name: string }[] = [
    { id: 'gemini', name: 'Gemini' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'groq', name: 'Groq' },
];

interface SessionTaskState {
    tasks: SessionTask[];
    currentTaskId: string | null;
}

interface TaskUpdateResult {
    currentTitle: string;
    tasks: SessionTask[];
    shouldShowTaskList: boolean;
}

const normalizeTaskTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

const createSessionTaskId = () => {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `task-${Date.now()}-${randomPart}`;
};

const createChatMessageId = () => {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `msg-${Date.now()}-${randomPart}`;
};

const waitForActionStatus = () => new Promise(resolve => setTimeout(resolve, 300));

const resolveCurrentTaskTitle = (taskUpdate: TaskUpdate | null, fallbackTask: string) => {
    const explicitCurrent = taskUpdate?.currentTaskTitle?.trim();
    if (explicitCurrent) return explicitCurrent;

    const flaggedCurrent = taskUpdate?.tasks.find(task => task.isCurrent)?.title.trim();
    if (flaggedCurrent) return flaggedCurrent;

    return fallbackTask.trim();
};

const App: React.FC = () => {
    const { user, loading: authLoading } = useAuth();
    const userRef = useRef(user);
    const { toasts, pushToast, dismissToast } = useToasts();

    // Daily session management — resets chat at midnight for signed-in users
    const handleSessionChange = useCallback((newSessionId: string) => {
        // Reset all chat state for the new day
        setTask(null);
        setMessages([]);
        setSessionTaskState({ tasks: [], currentTaskId: null });
        setStreamingText('');
        setStreamingComplete(false);
        setIsLoading(false);
        // Stop any active timers
        if (workerRef.current) {
            workerRef.current.postMessage({ action: 'stop' });
        }
        setActiveTimer(null);
    }, []);
    const { sessionId, isNewSession, displayDate, sessionLoading } = useDailySession(user, handleSessionChange);
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

    const [task, setTask] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [sessionTaskState, setSessionTaskState] = useState<SessionTaskState>({
        tasks: [],
        currentTaskId: null,
    });
    const [isInitializing, setIsInitializing] = useState<boolean>(true);
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

    // Keep userRef updated to avoid stale closures in worker callbacks
    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const currentSessionTask = useMemo(
        () => sessionTaskState.tasks.find(sessionTask => sessionTask.id === sessionTaskState.currentTaskId) ?? null,
        [sessionTaskState]
    );
    const currentTaskTitle = currentSessionTask?.title ?? task ?? '';

    const applyTaskUpdate = useCallback((taskUpdate: TaskUpdate | null, fallbackTask: string, shouldUseFallback: boolean): TaskUpdateResult => {
        const currentTitle = resolveCurrentTaskTitle(taskUpdate, shouldUseFallback ? fallbackTask : '');

        if (!taskUpdate && !currentTitle) {
            return {
                currentTitle: '',
                tasks: sessionTaskState.tasks,
                shouldShowTaskList: false,
            };
        }

        const detectedTasks = taskUpdate?.tasks ?? [];
        const todayDate = getTodayDateString();

        // Separate future-dated tasks from current-session tasks
        const futureTasks = detectedTasks.filter(t => t.scheduledDate && t.scheduledDate > todayDate);
        const todayTasks = detectedTasks.filter(t => !t.scheduledDate || t.scheduledDate <= todayDate);

        // Save future tasks to scheduledTasks collection
        if (futureTasks.length > 0 && user) {
            for (const ft of futureTasks) {
                const scheduledTask: ScheduledTask = {
                    id: createSessionTaskId(),
                    title: ft.title.trim(),
                    scheduledDate: ft.scheduledDate!,
                    createdAt: Date.now(),
                    consumed: false,
                };
                void dbService.saveScheduledTask(user.uid, scheduledTask);
            }
        }

        // Process today's tasks into the session
        const tasks = [...sessionTaskState.tasks];
        const tasksByTitle = new Map(tasks.map(sessionTask => [normalizeTaskTitle(sessionTask.title), sessionTask]));

        for (const detectedTask of todayTasks) {
            const title = detectedTask.title.trim();
            if (!title) continue;

            const normalizedTitle = normalizeTaskTitle(title);
            if (!tasksByTitle.has(normalizedTitle)) {
                const sessionTask: SessionTask = {
                    id: createSessionTaskId(),
                    title,
                    createdAt: Date.now(),
                };
                tasks.push(sessionTask);
                tasksByTitle.set(normalizedTitle, sessionTask);
            }
        }

        let currentTaskId = sessionTaskState.currentTaskId;
        if (currentTitle) {
            const normalizedCurrentTitle = normalizeTaskTitle(currentTitle);
            let currentTask = tasksByTitle.get(normalizedCurrentTitle);

            if (!currentTask) {
                currentTask = {
                    id: createSessionTaskId(),
                    title: currentTitle,
                    createdAt: Date.now(),
                };
                tasks.push(currentTask);
                tasksByTitle.set(normalizedCurrentTitle, currentTask);
            }

            currentTaskId = currentTask.id;
        }

        setSessionTaskState({ tasks, currentTaskId });

        currentTaskRef.current = currentTitle;

        // Sync to Firebase if user is logged in
        if (user) {
            tasks.forEach(t => void dbService.saveTask(user.uid, sessionId, t));
            void dbService.saveChatState(user.uid, sessionId, {
                task: currentTitle || fallbackTask || task,
                currentTaskId
            });
        }

        // shouldShowTaskList should reflect today tasks being added (not just future ones)
        const hasTodayTasksAdded = todayTasks.some(detectedTask => detectedTask.title.trim().length > 0);
        const hasFutureTasksAdded = futureTasks.length > 0;

        return {
            currentTitle,
            tasks,
            shouldShowTaskList: hasTodayTasksAdded || hasFutureTasksAdded,
        };
    }, [sessionTaskState, user, task, sessionId]);

    const getTaskListMessageMeta = (taskUpdateResult: TaskUpdateResult): Partial<ChatMessage> => {
        if (!taskUpdateResult.shouldShowTaskList || taskUpdateResult.tasks.length === 0) {
            return {};
        }

        return {
            showTaskList: true,
            taskListSnapshot: taskUpdateResult.tasks,
            currentTaskSnapshot: taskUpdateResult.currentTitle,
        };
    };

    const getTaskActionStatusText = (taskUpdateResult: TaskUpdateResult, reminder: ReminderConfig | null) => {
        const actions: string[] = [];

        if (taskUpdateResult.shouldShowTaskList) {
            actions.push(taskUpdateResult.tasks.length === 1 ? 'Added task to task list' : 'Added tasks to task list');
        }

        if (reminder) {
            actions.push('Set timer');
        }

        return actions.join(' and ');
    };

    const finishTaskActionStatus = useCallback(async (messageId: string, taskListMeta: Partial<ChatMessage>) => {
        await waitForActionStatus();
        setMessages(prev => prev.map(message => {
            if (message.id !== messageId) return message;

            return {
                ...message,
                showTaskActionStatus: true,
                ...taskListMeta,
            };
        }));
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

    // Close the settings modal with Escape
    useEffect(() => {
        if (!showApiKeyModal) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowApiKeyModal(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showApiKeyModal]);

    // Sync remote data when user signs in/out
    useEffect(() => {
        if (authLoading || sessionLoading) return; // Wait for auth and session to resolve

        if (!user) {
            // User signed out: reset state to default
            setTask(null);
            setMessages([]);
            setSessionTaskState({
                tasks: [],
                currentTaskId: null,
            });
            setIsInitializing(false);
            return;
        }

        const handleAuthSync = async () => {
            try {
                // 1. Sync settings if remote settings exist, otherwise upload local ones
                const remoteSettings = await dbService.loadSettings(user.uid);
                if (remoteSettings) {
                    setSelectedProvider(remoteSettings.provider);
                    setApiKeys(remoteSettings.apiKeys);
                    localStorage.setItem('ai_provider', remoteSettings.provider);
                    Object.entries(remoteSettings.apiKeys).forEach(([prov, key]) => {
                        localStorage.setItem(`${prov}_api_key`, key);
                    });
                } else {
                    await dbService.saveSettings(user.uid, {
                        provider: selectedProvider,
                        apiKeys,
                    });
                }

                // 2. Load remote messages, tasks, and state for the current session
                const remoteMessages = await dbService.loadMessages(user.uid, sessionId);
                const remoteTasks = await dbService.loadTasks(user.uid, sessionId);
                const remoteState = await dbService.loadChatState(user.uid, sessionId);

                // Migration: If user had active anonymous messages and signs in mid-session,
                // save their current progress to Firestore.
                if (messages.length > 0 && remoteMessages.length === 0) {
                    const localChatState = { task, currentTaskId: sessionTaskState.currentTaskId };
                    await dbService.syncLocalDataToFirebase(user.uid, sessionId, messages, sessionTaskState.tasks, localChatState);
                } else {
                    // Otherwise restore user's remote thread
                    if (remoteMessages.length > 0) {
                        setMessages(remoteMessages);
                    }
                    if (remoteTasks.length > 0 || remoteState?.currentTaskId) {
                        setSessionTaskState({
                            tasks: remoteTasks,
                            currentTaskId: remoteState?.currentTaskId || null
                        });
                    }
                    if (remoteState?.task) {
                        setTask(remoteState.task);
                        currentTaskRef.current = remoteState.task;
                    }
                }

                // 3. Load any scheduled tasks for today and inject them into the session
                const todayDate = getTodayDateString();
                const scheduledForToday = await dbService.loadScheduledTasksForDate(user.uid, todayDate);
                if (scheduledForToday.length > 0) {
                    // Convert scheduled tasks to session tasks
                    const newSessionTasks: SessionTask[] = scheduledForToday.map(st => ({
                        id: createSessionTaskId(),
                        title: st.title,
                        createdAt: Date.now(),
                    }));

                    // Merge into session state (dedup by title)
                    setSessionTaskState(prev => {
                        const existing = new Map(prev.tasks.map(t => [normalizeTaskTitle(t.title), t]));
                        const merged = [...prev.tasks];
                        for (const nst of newSessionTasks) {
                            if (!existing.has(normalizeTaskTitle(nst.title))) {
                                merged.push(nst);
                                existing.set(normalizeTaskTitle(nst.title), nst);
                            }
                        }
                        const firstNewId = newSessionTasks[0]?.id;
                        return {
                            tasks: merged,
                            currentTaskId: prev.currentTaskId || firstNewId || null,
                        };
                    });

                    // Save the injected tasks to the session in Firestore
                    for (const nst of newSessionTasks) {
                        void dbService.saveTask(user.uid, sessionId, nst);
                    }

                    // Set the main task if not already set, so the chat view activates
                    if (!remoteState?.task) {
                        const firstTitle = newSessionTasks[0]?.title || '';
                        setTask(firstTitle);
                        currentTaskRef.current = firstTitle;
                        void dbService.saveChatState(user.uid, sessionId, {
                            task: firstTitle,
                            currentTaskId: newSessionTasks[0]?.id || null
                        });
                    }

                    // Create a welcome message with the task card
                    const welcomeMsgId = createChatMessageId();
                    const taskCount = newSessionTasks.length;
                    const welcomeMsg: ChatMessage = {
                        id: welcomeMsgId,
                        sender: 'ai',
                        text: taskCount === 1
                            ? `Good morning! \u2728 You have a task lined up for today: "${newSessionTasks[0].title}". Ready to get started?`
                            : `Good morning! \u2728 You have ${taskCount} tasks lined up for today. Let's make it a productive one!`,
                        showTaskList: true,
                        taskListSnapshot: newSessionTasks,
                        currentTaskSnapshot: newSessionTasks[0]?.title,
                    };
                    setMessages(prev => [...prev, welcomeMsg]);
                    void dbService.saveMessage(user.uid, sessionId, welcomeMsg);

                    // Mark scheduled tasks as consumed
                    await dbService.markScheduledTasksConsumed(
                        user.uid,
                        scheduledForToday.map(st => st.id)
                    );
                }
            } catch (error) {
                console.error('Error syncing auth state data:', error);
            } finally {
                setIsInitializing(false);
            }
        };

        void handleAuthSync();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading, sessionId, sessionLoading]);

    const handleSaveSettings = () => {
        localStorage.setItem('ai_provider', selectedProvider);
        localStorage.setItem('gemini_api_key', apiKeys.gemini.trim());
        localStorage.setItem('openai_api_key', apiKeys.openai.trim());
        localStorage.setItem('openrouter_api_key', apiKeys.openrouter.trim());
        localStorage.setItem('groq_api_key', apiKeys.groq.trim());
        setShowApiKeyModal(false);

        if (user) {
            void dbService.saveSettings(user.uid, {
                provider: selectedProvider,
                apiKeys
            });
        }
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
            const taskForCheckin = currentTaskRef.current || getCurrentTask() || fallbackTask;
            const checkinMessage = await generateCheckinMessage(taskForCheckin);

            // Show browser notification if permission granted
            if (Notification.permission === 'granted') {
                new Notification('Focus Fairy Check-in ✨', {
                    body: checkinMessage,
                    icon: '/fairy.svg'
                });
            }

            // Add message to chat
            const msgId = createChatMessageId();
            const msg: ChatMessage = { id: msgId, sender: 'ai', text: `🔔 ${checkinMessage}` };
            setMessages(prev => [...prev, msg]);
            const currentUser = userRef.current;
            if (currentUser) {
                void dbService.saveMessage(currentUser.uid, sessionIdRef.current, msg);
            }
        } catch {
            pushToast('Check-in failed. Please check your API key in Settings.', 'error');
        } finally {
            isGeneratingRef.current = false;
        }
    }, [pushToast]);

    // One-time reminder - using Web Worker for reliable background execution
    const setOneTimeReminder = useCallback((minutes: number, fallbackTask: string, taskListMeta: Partial<ChatMessage> = {}) => {
        // Store task for callback
        currentTaskRef.current = fallbackTask;
        timerTypeRef.current = 'one-time';

        const milliseconds = minutes * 60 * 1000;
        const timeDisplay = minutes >= 1 ? `${minutes} minute(s)` : `${Math.round(minutes * 60)} seconds`;

        setActiveTimer(minutes);

        const notifStatus = Notification.permission === 'granted'
            ? ''
            : ' (⚠️ Enable notifications in your browser for alerts!)';
        const msgId = createChatMessageId();
        const msg: ChatMessage = {
            id: msgId,
            sender: 'ai',
            text: `⏰ Got it! I'll remind you in ${timeDisplay}.${notifStatus}`,
            ...taskListMeta,
        };
        setMessages(prev => [...prev, msg]);
        if (user) {
            void dbService.saveMessage(user.uid, sessionId, msg);
        }

        // Start worker timer
        if (workerRef.current) {
            workerRef.current.postMessage({ action: 'start', milliseconds, type: 'one-time' });
        }
    }, [user, sessionId]);

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

function formatTaskForCheckin(task: string): string {
    if (!task) return '';
    let cleaned = task.trim();
    if (!cleaned) return '';

    // Remove any surrounding quotes or punctuation
    cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();

    // Strip leading conversational phrases
    cleaned = cleaned.replace(/^(?:i\s+need\s+to|i\s+have\s+to|i\s+want\s+to|need\s+to|want\s+to|to)\s+/i, '');

    const words = cleaned.split(/\s+/);
    if (words.length === 0 || !words[0]) return '';

    const firstWord = words[0];
    const restOfWords = words.slice(1).join(' ');

    // Convert pronouns in rest of words
    const rephrasedRest = restOfWords
        ? restOfWords
            .replace(/\bmy\b/gi, 'your')
            .replace(/\bmyself\b/gi, 'yourself')
            .replace(/\bour\b/gi, 'your')
            .replace(/\bourselves\b/gi, 'yourselves')
            .replace(/\bme\b/gi, 'you')
        : '';

    const verbToGerund: Record<string, string> = {
        send: 'sending',
        write: 'writing',
        read: 'reading',
        study: 'studying',
        clean: 'cleaning',
        do: 'doing',
        make: 'making',
        take: 'taking',
        finish: 'finishing',
        complete: 'completing',
        fix: 'fixing',
        review: 'reviewing',
        work: 'working',
        prepare: 'preparing',
        code: 'coding',
        build: 'building',
        draft: 'drafting',
        organize: 'organizing',
        plan: 'planning',
        practice: 'practicing',
        check: 'checking',
        update: 'updating',
        edit: 'editing',
        create: 'creating',
        research: 'researching',
        solve: 'solving',
        watch: 'watching',
        listen: 'listening',
        run: 'running',
        learn: 'learning',
        debug: 'debugging',
        refactor: 'refactoring',
        set: 'setting',
        start: 'starting',
        tidy: 'tidying',
        wash: 'washing',
        cook: 'cooking',
        exercise: 'exercising',
        walk: 'walking',
        buy: 'buying',
        call: 'calling',
        email: 'emailing',
        message: 'messaging',
        submit: 'submitting',
        fill: 'filling',
        grade: 'grading',
        revise: 'revising',
        draw: 'drawing',
        paint: 'painting',
        design: 'designing',
        test: 'testing',
        implement: 'implementing',
        deploy: 'deploying',
        format: 'formatting',
        generate: 'generating',
        summarize: 'summarizing',
        memorize: 'memorizing',
        rehearse: 'rehearsing',
        pack: 'packing',
        sort: 'sorting',
        file: 'filing',
        clear: 'clearing',
        record: 'recording',
        print: 'printing',
        scan: 'scanning',
        schedule: 'scheduling',
        arrange: 'arranging',
        brainstorm: 'brainstorming',
        analyze: 'analyzing',
        inspect: 'inspecting',
        examine: 'examining',
        apply: 'applying',
        order: 'ordering',
        shop: 'shopping',
        browse: 'browsing',
        search: 'searching',
        type: 'typing',
        calculate: 'calculating',
        translate: 'translating',
        convert: 'converting',
        optimize: 'optimizing',
        configure: 'configuring',
        install: 'installing',
        setup: 'setting up',
        sync: 'syncing',
        push: 'pushing',
        pull: 'pulling',
        commit: 'committing',
        merge: 'merging',
        post: 'posting',
        publish: 'publishing',
        tweet: 'tweeting',
        upload: 'uploading',
        download: 'downloading',
        backup: 'backing up',
        restore: 'restoring',
        eat: 'eating',
        drink: 'drinking',
        get: 'getting',
        give: 'giving',
        find: 'finding',
        choose: 'choosing',
        pick: 'picking',
        answer: 'answering',
        respond: 'responding',
        tackle: 'tackling',
        focus: 'focusing',
        outline: 'outlining',
        compose: 'composing',
        compile: 'compiling',
        wrap: 'wrapping',
        cut: 'cutting',
        put: 'putting',
        drop: 'dropping',
        ship: 'shipping',
        deliver: 'delivering',
        pitch: 'pitching',
        sell: 'selling',
        pay: 'paying',
        audit: 'auditing',
        track: 'tracking',
        train: 'training',
        teach: 'teaching',
        log: 'logging',
        sign: 'signing',
        proofread: 'proofreading',
        summarise: 'summarising',
        analyse: 'analysing',
        organise: 'organising',
        practise: 'practising',
        memorise: 'memorising',
        optimise: 'optimising',
    };

    const lowerFirst = firstWord.toLowerCase();

    let gerund = '';
    if (lowerFirst.endsWith('ing')) {
        gerund = lowerFirst;
    } else if (verbToGerund[lowerFirst]) {
        gerund = verbToGerund[lowerFirst];
    } else if (lowerFirst.endsWith('e') && !lowerFirst.endsWith('ee') && !lowerFirst.endsWith('oe') && !lowerFirst.endsWith('ye')) {
        gerund = lowerFirst.slice(0, -1) + 'ing';
    } else if (lowerFirst.endsWith('ie')) {
        gerund = lowerFirst.slice(0, -2) + 'ying';
    }

    if (gerund) {
        return rephrasedRest ? `${gerund} ${rephrasedRest}` : gerund;
    }

    const rephrasedFirst = /^[A-Z]{2,}$/.test(firstWord) ? firstWord : firstWord.toLowerCase();
    return rephrasedRest ? `${rephrasedFirst} ${rephrasedRest}` : rephrasedFirst;
}

    // Handle reminder configuration from AI tool calls
    const handleReminderConfig = useCallback((reminder: ReminderConfig | null, fallbackTask: string, messageMeta: Partial<ChatMessage> = {}) => {
        if (!reminder) {
            return;
        }

        // Check browser API directly instead of React state (which can be stale)
        const currentPermission = Notification.permission;

        if (currentPermission !== 'granted') {
            pushToast('Enable notifications in your browser to get check-in reminders!', 'warning');
            return;
        }

        const timeDisplay = reminder.minutes >= 1
            ? `${reminder.minutes} minute(s)`
            : `${Math.round(reminder.minutes * 60)} seconds`;

        if (reminder.type === 'one-time') {
            setOneTimeReminder(reminder.minutes, fallbackTask, messageMeta);
        } else {
            // Add a message for recurring check-ins
            const msgId = createChatMessageId();
            const rephrasedTask = formatTaskForCheckin(fallbackTask);
            const taskContext = rephrasedTask
                ? ` with ${rephrasedTask}`
                : '';
            const msg: ChatMessage = {
                id: msgId,
                sender: 'ai',
                text: `✨ I'll keep checking in on your progress${taskContext}! Let's do this!`,
                ...messageMeta,
            };
            setMessages(prev => [...prev, msg]);
            if (user) {
                void dbService.saveMessage(user.uid, sessionId, msg);
            }
            startRecurringCheckin(reminder.minutes, fallbackTask);
        }
    }, [setOneTimeReminder, startRecurringCheckin, user, sessionId]);

    const handleTaskSubmit = async (newTask: string) => {
        if (!newTask.trim()) return;
        setTask(newTask);

        // Immediately show the user's message before waiting for AI response
        const userMsgId = createChatMessageId();
        const userMessage: ChatMessage = { id: userMsgId, sender: 'user', text: newTask };
        setMessages([userMessage]);
        if (user) {
            void dbService.saveMessage(user.uid, sessionId, userMessage);
            void dbService.saveChatState(user.uid, sessionId, { task: newTask, currentTaskId: null });
        }
        setIsLoading(true);
        setStreamingText('');
        setStreamingComplete(false);

        try {
            initializeChat();
            
            // Stream text with callback for real-time updates
            const onChunk = (text: string) => {
                setStreamingText(text);
            };
            
            const { text, reminder, taskUpdate } = await streamInitialResponse(newTask, onChunk);

            // Mark streaming as complete (keeps showing last text until we add message)
            setStreamingComplete(true);
            
            const taskUpdateResult = applyTaskUpdate(taskUpdate, newTask, Boolean(reminder));
            const taskListMeta = getTaskListMessageMeta(taskUpdateResult);
            const actionStatusText = getTaskActionStatusText(taskUpdateResult, reminder);
            const shouldShowTaskAction = actionStatusText.length > 0;
            const actionMessageId = createChatMessageId();

            // Now add the final message
            const aiMessageId = reminder && shouldShowTaskAction ? createChatMessageId() : actionMessageId;
            const aiMessage: ChatMessage = {
                id: aiMessageId,
                sender: 'ai',
                text,
                showTaskActionStatus: !reminder && shouldShowTaskAction,
                taskActionStatusText: !reminder && shouldShowTaskAction ? actionStatusText : undefined,
                ...(!reminder && !shouldShowTaskAction ? taskListMeta : {}),
            };
            setMessages(prev => [...prev, aiMessage]);
            if (user) {
                void dbService.saveMessage(user.uid, sessionId, aiMessage);
            }
            setStreamingText('');
            setStreamingComplete(false);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(
                reminder,
                taskUpdateResult.currentTitle || newTask,
                shouldShowTaskAction ? { id: actionMessageId, showTaskActionStatus: true, taskActionStatusText: actionStatusText } : taskListMeta
            );
            setIsLoading(false);

            if (shouldShowTaskAction) {
                await finishTaskActionStatus(actionMessageId, taskListMeta);
            }

        } catch {
            pushToast("To use Focus Fairy, please add your own API key in Settings. Don't worry, you can use free-tier keys!", 'error');

            // Fallback: start default recurring check-in on error
            if (Notification.permission === 'granted') {
                applyTaskUpdate(null, newTask, true);
                startRecurringCheckin(DEFAULT_CHECKIN_MINUTES, newTask);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (userMessage: string) => {
        if (!userMessage.trim() || !task) return;

        const userMsgId = createChatMessageId();
        const userMsg: ChatMessage = { id: userMsgId, sender: 'user', text: userMessage };
        setMessages(prev => [...prev, userMsg]);
        if (user) {
            void dbService.saveMessage(user.uid, sessionId, userMsg);
        }
        setIsLoading(true);
        setStreamingText('');
        setStreamingComplete(false);

        try {
            // Stream text with callback for real-time updates
            const onChunk = (text: string) => {
                setStreamingText(text);
            };
            
            const { text, reminder, taskUpdate } = await streamContinueChat(userMessage, onChunk);
            
            // Mark streaming as complete (keeps showing last text until we add message)
            setStreamingComplete(true);
            
            const taskUpdateResult = applyTaskUpdate(taskUpdate, userMessage, Boolean(reminder));
            const taskListMeta = getTaskListMessageMeta(taskUpdateResult);
            const actionStatusText = getTaskActionStatusText(taskUpdateResult, reminder);
            const shouldShowTaskAction = actionStatusText.length > 0;
            const actionMessageId = createChatMessageId();

            // Now add the final message
            const aiMessageId = reminder && shouldShowTaskAction ? createChatMessageId() : actionMessageId;
            const aiMsg: ChatMessage = {
                id: aiMessageId,
                sender: 'ai',
                text,
                showTaskActionStatus: !reminder && shouldShowTaskAction,
                taskActionStatusText: !reminder && shouldShowTaskAction ? actionStatusText : undefined,
                ...(!reminder && !shouldShowTaskAction ? taskListMeta : {}),
            };
            setMessages(prev => [...prev, aiMsg]);
            if (user) {
                void dbService.saveMessage(user.uid, sessionId, aiMsg);
            }
            setStreamingText('');
            setStreamingComplete(false);

            // Let AI decide the reminder configuration via tool calling
            handleReminderConfig(
                reminder,
                taskUpdateResult.currentTitle || currentTaskTitle || task,
                shouldShowTaskAction ? { id: actionMessageId, showTaskActionStatus: true, taskActionStatusText: actionStatusText } : taskListMeta
            );
            setIsLoading(false);

            if (shouldShowTaskAction) {
                await finishTaskActionStatus(actionMessageId, taskListMeta);
            }

        } catch {
            pushToast("I'm having trouble responding right now. Let's try again in a moment.", 'error');
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
                    currentTask={currentTaskTitle}
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isLoading={isLoading}
                    streamingText={streamingText}
                    streamingComplete={streamingComplete}
                    onApiKeyClick={() => setShowApiKeyModal(true)}
                    displayDate={displayDate}
                />
            ) : (
                <InitialTaskInput
                    onTaskSubmit={handleTaskSubmit}
                    isLoading={isLoading}
                    isInitializing={isInitializing}
                    onApiKeyClick={() => setShowApiKeyModal(true)}
                    displayDate={displayDate}
                />
            )}

            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />

            {/* API Key Modal */}
            {showApiKeyModal && (
                <div
                    className="modal-overlay fixed inset-0 flex items-center justify-center z-50"
                    style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)'
                    }}
                    onClick={() => setShowApiKeyModal(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="api-key-modal-title"
                        className="modal-panel custom-scrollbar rounded-2xl p-4 sm:p-6 max-w-md w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
                        style={{
                            backgroundColor: 'var(--bg-warm)',
                            border: '1px solid var(--border-light)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 id="api-key-modal-title" className="font-title text-2xl font-semibold mb-4" style={{ color: 'var(--text-dark)' }}>
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
                                    className="flex items-center gap-3 p-3 rounded-xl transition-all text-left"
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
