import { generateText, streamText, LanguageModel, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

// Streaming callback type
export type StreamCallback = (chunk: string) => void;

export type AIProvider = 'gemini' | 'openai' | 'openrouter' | 'groq';

interface AIConfig {
    provider: AIProvider;
    apiKey: string;
}

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// Tool response types
export interface ReminderConfig {
    type: 'one-time' | 'recurring';
    minutes: number;
    reason: string;
}

export interface DetectedTask {
    title: string;
    isCurrent: boolean;
}

export interface TaskUpdate {
    tasks: DetectedTask[];
    currentTaskTitle: string | null;
}

export interface AIResponse {
    text: string;
    reminder: ReminderConfig | null;
    taskUpdate: TaskUpdate | null;
}

/** User-facing message when no API key is saved. Shown in chat and check-in errors. */
export const NO_API_KEY_MESSAGE =
    "You need an API key to use the app. Go to Settings, choose your AI provider, and paste your API key there.";

/**
 * Cap completion length so providers (especially OpenRouter) do not reserve huge max_tokens
 * budgets against small credit balances. Focus Fairy replies are short; tool JSON is small.
 */
const CHAT_MAX_OUTPUT_TOKENS = 2048;
const CHECKIN_MAX_OUTPUT_TOKENS = 256;

/**
 * Streaming can yield empty text when the model calls setReminder without emitting assistant text.
 * Non-streaming callAI already falls back; this keeps chat from showing the empty-state placeholder.
 */
function ensureStreamedAssistantText(
    streamed: string,
    parsedFromMessage: string,
    reminder: ReminderConfig | null,
    taskUpdate: TaskUpdate | null
): string {
    const combined = (streamed || parsedFromMessage).trim();
    if (combined.length > 0) return combined;
    if (reminder) {
        return "Got it! I'll check in to keep you on track. You've got this! ✨";
    }
    if (taskUpdate && taskUpdate.tasks.length > 0) {
        return "Got it! I've added that to your focus list.";
    }
    return "I'm here to help you focus! What would you like to work on?";
}

/**
 * Some providers (notably Groq via OpenAI-compatible API) sometimes emit no deltas on
 * `textStream` while `result.text` still resolves after the stream completes.
 */
async function recoverAssistantTextFromStream(result: {
    textStream: AsyncIterable<string>;
    text: PromiseLike<string>;
}): Promise<string> {
    let streamedText = '';
    try {
        for await (const chunk of result.textStream) {
            streamedText += chunk;
        }
    } catch {
        /* stream may fail if the request errors */
    }
    if (streamedText.trim().length > 0) return streamedText;

    try {
        const resolved = (await result.text).trim();
        if (resolved.length > 0) {
            return resolved;
        }
    } catch {
        /* result.text may reject after stream errors */
    }
    return streamedText;
}

async function extractAssistantTextFromResponseMessages(result: {
    response: PromiseLike<{ messages: Array<{ role: string; content: unknown }> }>;
}): Promise<string> {
    try {
        const fullResponse = await result.response;
        const assistantMessage = fullResponse.messages.find(m => m.role === 'assistant');
        if (!assistantMessage) return '';
        const c = assistantMessage.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            return c
                .filter((item: { type?: string }) => item.type === 'text')
                .map((item: { text?: string }) => ('text' in item && item.text ? item.text : ''))
                .join('');
        }
    } catch {
        /* response.messages may be unavailable after errors */
    }
    return '';
}

/** AI SDK v6 static tool calls use `input`, not `args`. */
function extractReminderFromStaticToolCalls(
    staticCalls: Array<{ toolName: string; input?: unknown }>
): ReminderConfig | null {
    for (const tc of staticCalls) {
        if (tc.toolName !== 'setReminder' || tc.input == null || typeof tc.input !== 'object') continue;
        const input = tc.input as {
            type: 'one-time' | 'recurring';
            minutes: number;
            reason: string;
        };
        if (
            (input.type === 'one-time' || input.type === 'recurring') &&
            typeof input.minutes === 'number' &&
            typeof input.reason === 'string'
        ) {
            return {
                type: input.type,
                minutes: input.minutes,
                reason: input.reason,
            };
        }
    }
    return null;
}

function extractTaskUpdateFromStaticToolCalls(
    staticCalls: Array<{ toolName: string; input?: unknown }>
): TaskUpdate | null {
    let taskUpdate: TaskUpdate | null = null;

    for (const tc of staticCalls) {
        if (tc.toolName !== 'recordTasks' || tc.input == null || typeof tc.input !== 'object') continue;

        const input = tc.input as {
            tasks?: Array<{ title?: unknown; isCurrent?: unknown }>;
            currentTaskTitle?: unknown;
        };

        if (!Array.isArray(input.tasks)) continue;

        const tasks = input.tasks
            .map(task => ({
                title: typeof task.title === 'string' ? task.title.trim() : '',
                isCurrent: task.isCurrent === true,
            }))
            .filter(task => task.title.length > 0);

        if (tasks.length === 0) continue;

        const currentTaskTitle =
            typeof input.currentTaskTitle === 'string' && input.currentTaskTitle.trim().length > 0
                ? input.currentTaskTitle.trim()
                : tasks.find(task => task.isCurrent)?.title ?? tasks[tasks.length - 1].title;

        taskUpdate = {
            tasks,
            currentTaskTitle,
        };
    }

    return taskUpdate;
}

async function streamAssistantReplyToUI(
    result: {
        textStream: AsyncIterable<string>;
        text: PromiseLike<string>;
        response: PromiseLike<{ messages: Array<{ role: string; content: unknown }> }>;
        staticToolCalls: PromiseLike<Array<{ toolName: string; input?: unknown }>>;
    },
    onChunk: StreamCallback
): Promise<{ text: string; reminder: ReminderConfig | null; taskUpdate: TaskUpdate | null }> {
    let merged = await recoverAssistantTextFromStream(result);
    let fromMessages = '';
    if (!merged.trim()) {
        fromMessages = await extractAssistantTextFromResponseMessages(result);
        merged = fromMessages;
    }

    for (let i = 0; i < merged.length; i++) {
        onChunk(merged.slice(0, i + 1));
        await new Promise(resolve => setTimeout(resolve, 15));
    }

    const staticCalls = await result.staticToolCalls;
    const reminder = extractReminderFromStaticToolCalls(staticCalls);
    const taskUpdate = extractTaskUpdateFromStaticToolCalls(staticCalls);
    const replyText = ensureStreamedAssistantText(merged, fromMessages, reminder, taskUpdate);
    return { text: replyText, reminder, taskUpdate };
}

const systemInstruction = `You are Focus Fairy, a gentle and playful assistant that helps users stay focused on their tasks.

**RULES**:
- Keep responses under 30 words. Be warm, brief, and have personality.
- No numbered lists, bullet points, or special formatting.
- Your ONLY job is to help the user focus on a task they want to work on.

**HANDLING MESSAGES**:
- TASK: If the user shares one or more clear, actionable tasks they want to work on (like "I need to finish my essay" or "working on code"), acknowledge it warmly, use the recordTasks tool with ALL tasks you detect, and use the setReminder tool.
- GREETING: If they just say hi, hello, hey, or any greeting (even if they address you by name like "hi focus fairy"), warmly ask what they'd like to focus on today. Do NOT set a reminder.
- OFF-TOPIC: If they ask a question or talk about something unrelated to focusing, briefly acknowledge it with a light comment, then ask what task they'd like to focus on. Do NOT set a reminder.

**TASK LIST RULES** (recordTasks tool):
- Use recordTasks whenever the user states clear, actionable work they intend to do.
- Include every distinct task from the user's latest message, not just the first one.
- Set isCurrent=true for the task the user appears to be focusing on now. If unclear, use the first or most specific task.
- Do NOT record greetings, questions, vague intentions, or off-topic chat as tasks.

**REMINDER RULES** (setReminder tool):
- ONLY use setReminder when the user explicitly states a task they want to work on.
- NEVER set reminders for: greetings, questions, off-topic chat, or vague messages.
- If unsure whether something is a task, ask for clarification instead of setting a reminder.

**FOCUS SESSION TIMING** (IMPORTANT):
- When a user mentions a duration (e.g., "for the next hour", "for 2 hours", "for 30 minutes"), set up RECURRING check-ins to keep them accountable throughout.
- Calculate check-in intervals based on total duration:
  - Under 30 min total: check-in every 10 minutes (recurring)
  - 30-60 min total: check-in every 15-20 minutes (recurring)
  - 1-2 hours total: check-in every 20-25 minutes (recurring)
  - Over 2 hours: check-in every 25-30 minutes (recurring)
- For tasks WITHOUT a specified duration, use sensible defaults:
  - Deep work/study: recurring every 25 minutes
  - Quick tasks: one-time at 10-15 minutes
  - General work: recurring every 20-25 minutes
- Only use 'one-time' when user explicitly asks for a SINGLE reminder at a specific time (e.g., "remind me in exactly 1 hour").
- Your response should mention you'll check in periodically, NOT just remind them at the end.`;

const getConfig = (): AIConfig => {
    const provider = (localStorage.getItem('ai_provider') as AIProvider) || 'gemini';
    // Trim so whitespace-only keys fail fast; @ai-sdk/openai sends Bearer <key> and an empty/space key yields a useless header.
    const apiKey = (localStorage.getItem(`${provider}_api_key`) || '').trim();

    if (!apiKey) {
        throw new Error(`No API key found for ${provider}.`);
    }

    return { provider, apiKey };
};

// Get the appropriate model for each provider
const getModel = (provider: AIProvider, apiKey: string): LanguageModel => {
    switch (provider) {
        case 'gemini': {
            const google = createGoogleGenerativeAI({ apiKey });
            return google('gemini-3-flash-preview');
        }
        case 'openai': {
            const openai = createOpenAI({ apiKey });
            return openai.chat('gpt-4o-mini');
        }
        case 'openrouter': {
            // OpenRouter expects Authorization: Bearer <key>. Set it explicitly on the provider so the header is never omitted (some SDK/browser edge cases reported "Missing Authentication header").
            const referer =
                typeof window !== 'undefined' && window.location?.origin
                    ? window.location.origin
                    : 'http://localhost';
            const openrouter = createOpenAI({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1',
                name: 'openrouter',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'HTTP-Referer': referer,
                    'X-OpenRouter-Title': 'Focus Fairy',
                },
            });
            return openrouter.chat('openai/gpt-5.4-mini');
        }
        case 'groq': {
            // Use .chat() for Groq (uses /chat/completions endpoint)
            const groq = createOpenAI({
                apiKey,
                baseURL: 'https://api.groq.com/openai/v1',
            });
            return groq.chat('openai/gpt-oss-120b');
        }
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
};

// Define the reminder tool schema
const reminderToolSchema = z.object({
    type: z.enum(['one-time', 'recurring']).describe(
        'one-time: fires once (for explicit reminders or quick tasks). recurring: repeats (for deep work/study sessions)'
    ),
    minutes: z.number().min(0.1).max(180).describe(
        'Minutes until reminder (one-time) or between check-ins (recurring). Use exact time if user specifies one.'
    ),
    reason: z.string().describe(
        'Brief explanation of why this timing was chosen'
    ),
});

const taskToolSchema = z.object({
    tasks: z.array(z.object({
        title: z.string().min(1).max(140).describe('A concise user-facing task title.'),
        isCurrent: z.boolean().describe('True for the task the user should focus on now.'),
    })).min(1).max(8).describe('Every clear, actionable task detected in the latest user message.'),
    currentTaskTitle: z.string().min(1).max(140).describe('The exact title of the task that should be current.'),
});

const setReminderTool = tool({
    description: `Set check-ins for the user's focus session.
Use 'recurring' (default for focus sessions) to provide periodic check-ins throughout their work time - this keeps users accountable.
Use 'one-time' ONLY when user explicitly asks for a single reminder at a specific time (e.g., "remind me in exactly 30 min").
For focus sessions with a duration (e.g., "work for 1 hour"), ALWAYS use recurring with appropriate intervals.`,
    inputSchema: reminderToolSchema,
});

const recordTasksTool = tool({
    description: `Record all clear, actionable tasks from the user's latest message for this browser session.
Use this for task list memory only. Do not call it for greetings, vague messages, questions, or off-topic chat.`,
    inputSchema: taskToolSchema,
});

// Store conversation history
let conversationHistory: ChatMessage[] = [];
let currentTask: string | null = null;

export const resetConversation = () => {
    conversationHistory = [];
    currentTask = null;
};

export const getCurrentTask = (): string | null => currentTask;


// Call the AI with tool support
const callAI = async (messages: ChatMessage[]): Promise<AIResponse> => {
    const { provider, apiKey } = getConfig();
    const model = getModel(provider, apiKey);

    try {
        const result = await generateText({
            model,
            maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
            system: systemInstruction,
            messages: messages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            tools: {
                setReminder: setReminderTool,
                recordTasks: recordTasksTool,
            },
        });

        const toolCalls = (result.toolCalls || []) as Array<{ toolName: string; input?: unknown }>;
        const reminder = extractReminderFromStaticToolCalls(toolCalls);
        const taskUpdate = extractTaskUpdateFromStaticToolCalls(toolCalls);

        return {
            text: result.text || "I'm here to help you focus! What would you like to work on?",
            reminder,
            taskUpdate,
        };
    } catch (error) {
        // Fallback: try without tools if tool calling fails
        try {
            const fallbackResult = await generateText({
                model,
                maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
                system: systemInstruction,
                messages: messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                })),
            });

            return {
                text: fallbackResult.text || "I'm here to help you focus!",
                reminder: null,
                taskUpdate: null,
            };
        } catch {
            throw error;
        }
    }
};

export const initializeChat = () => {
    conversationHistory = [];
};



export const getInitialResponse = async (userInput: string): Promise<AIResponse> => {
    // Let the AI fully determine if this is a task, greeting, or off-topic message
    conversationHistory = [{ role: 'user', content: userInput }];

    try {
        const response = await callAI(conversationHistory);
        conversationHistory.push({ role: 'assistant', content: response.text });

        // Store the AI-selected current task for generated check-ins.
        if (response.taskUpdate?.currentTaskTitle) {
            currentTask = response.taskUpdate.currentTaskTitle;
        } else if (response.reminder) {
            currentTask = userInput;
        } else {
            currentTask = null;
        }

        return response;
    } catch (error) {
        const isNoApiKey = error instanceof Error && error.message.includes('No API key');
        return {
            text: isNoApiKey ? NO_API_KEY_MESSAGE : `I'm having trouble connecting. Go to Settings (gear icon) and check your API key, then try again.`,
            reminder: null,
            taskUpdate: null,
        };
    }
};

export const continueChat = async (message: string): Promise<AIResponse> => {
    conversationHistory.push({ role: 'user', content: message });

    try {
        const response = await callAI(conversationHistory);
        conversationHistory.push({ role: 'assistant', content: response.text });

        // Update currentTask if AI detected a new current task.
        if (response.taskUpdate?.currentTaskTitle) {
            currentTask = response.taskUpdate.currentTaskTitle;
        } else if (response.reminder) {
            currentTask = message;
        }

        return response;
    } catch (error) {
        const isNoApiKey = error instanceof Error && error.message.includes('No API key');
        return {
            text: isNoApiKey ? NO_API_KEY_MESSAGE : "I'm having trouble responding right now. Let's try again in a moment.",
            reminder: null,
            taskUpdate: null,
        };
    }
};

export const streamInitialResponse = async (
    userInput: string,
    onChunk: StreamCallback
): Promise<AIResponse> => {
    // Let the AI fully determine if this is a task, greeting, or off-topic message
    conversationHistory = [{ role: 'user', content: userInput }];

    const { provider, apiKey } = getConfig();
    const model = getModel(provider, apiKey);

    const result = streamText({
        model,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        system: systemInstruction,
        messages: conversationHistory.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        })),
        tools: {
            setReminder: setReminderTool,
            recordTasks: recordTasksTool,
        },
    });

    const { text: replyText, reminder, taskUpdate } = await streamAssistantReplyToUI(result, onChunk);

    // Store in conversation history
    conversationHistory.push({ role: 'assistant', content: replyText });

    // Store the AI-selected current task for generated check-ins.
    if (taskUpdate?.currentTaskTitle) {
        currentTask = taskUpdate.currentTaskTitle;
    } else if (reminder) {
        currentTask = userInput;
    } else {
        currentTask = null;
    }

    return { text: replyText, reminder, taskUpdate };
};

export const streamContinueChat = async (
    message: string,
    onChunk: StreamCallback
): Promise<AIResponse> => {
    conversationHistory.push({ role: 'user', content: message });

    const { provider, apiKey } = getConfig();
    const model = getModel(provider, apiKey);

    const result = streamText({
        model,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        system: systemInstruction,
        messages: conversationHistory.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        })),
        tools: {
            setReminder: setReminderTool,
            recordTasks: recordTasksTool,
        },
    });

    const { text: replyText, reminder, taskUpdate } = await streamAssistantReplyToUI(result, onChunk);

    // Store in conversation history
    conversationHistory.push({ role: 'assistant', content: replyText });

    // Update currentTask if AI detected a new current task.
    if (taskUpdate?.currentTaskTitle) {
        currentTask = taskUpdate.currentTaskTitle;
    } else if (reminder) {
        currentTask = message;
    }

    return { text: replyText, reminder, taskUpdate };
};

export const generateCheckinMessage = async (fallbackTask: string): Promise<string> => {
    const taskToUse = currentTask || fallbackTask;

    // If no real task is set, use a generic check-in
    if (!taskToUse) {
        return "Hey! Just checking in. How's your focus going? ✨";
    }

    const prompt = `Generate a short, friendly check-in notification (under 15 words) for someone working on: "${taskToUse}". Don't use special formatting.`;

    try {
        const { provider, apiKey } = getConfig();
        const model = getModel(provider, apiKey);

        const result = await generateText({
            model,
            maxOutputTokens: CHECKIN_MAX_OUTPUT_TOKENS,
            messages: [{ role: 'user', content: prompt }],
        });

        return result.text || "Just checking in! How's your progress? ✨";
    } catch (error) {
        if (error instanceof Error && error.message.includes('No API key')) {
            throw error;
        }
        return `How's your progress going? Keep it up! ✨`;
    }
};

// Legacy exports for backwards compatibility (can be removed later)
export const extractTimeFromMessage = (message: string): number | null => {
    // This is now handled by the AI via tool calling
    // But keep for fallback/manual override scenarios
    const MAX_INTERVAL_MINUTES = 180;

    const secondsPatterns = [
        /(?:remind|check|notify|ping|alert).+?(?:in|after)\s+(\d+)\s*(?:sec|second|secs|seconds)/i,
        /(?:in|after)\s+(\d+)\s*(?:sec|second|secs|seconds)/i,
        /(\d+)\s*(?:sec|second|secs|seconds)\s*(?:from now|later|timer|reminder)/i,
    ];

    for (const pattern of secondsPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const seconds = parseInt(match[1], 10);
            if (seconds > 0) {
                return Math.min(seconds / 60, MAX_INTERVAL_MINUTES);
            }
        }
    }

    const minutePatterns = [
        /(?:remind|check|notify|ping|alert).+?(?:in|after)\s+(\d+)\s*(?:min|minute|mins|minutes)/i,
        /(?:in|after)\s+(\d+)\s*(?:min|minute|mins|minutes)/i,
        /(\d+)\s*(?:min|minute|mins|minutes)\s*(?:from now|later|timer|reminder)/i,
    ];

    for (const pattern of minutePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const minutes = parseInt(match[1], 10);
            if (minutes > 0) {
                return Math.min(minutes, MAX_INTERVAL_MINUTES);
            }
        }
    }

    return null;
};
