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

export interface AIResponse {
    text: string;
    reminder: ReminderConfig | null;
}

/** User-facing message when no API key is saved. Shown in chat and check-in errors. */
export const NO_API_KEY_MESSAGE =
    "You need an API key to use the app. Go to Settings, choose your AI provider, and paste your API key there.";

const systemInstruction = `You are Focus Fairy, a gentle and playful assistant that helps users stay focused on their tasks.

**RULES**:
- Keep responses under 30 words. Be warm, brief, and have personality.
- No numbered lists, bullet points, or special formatting.
- Your ONLY job is to help the user focus on a task they want to work on.

**HANDLING MESSAGES**:
- TASK: If the user shares a clear, actionable task they want to work on (like "I need to finish my essay" or "working on code"), acknowledge it warmly and use the setReminder tool.
- GREETING: If they just say hi, hello, hey, or any greeting (even if they address you by name like "hi focus fairy"), warmly ask what they'd like to focus on today. Do NOT set a reminder.
- OFF-TOPIC: If they ask a question or talk about something unrelated to focusing, briefly acknowledge it with a light comment, then ask what task they'd like to focus on. Do NOT set a reminder.

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
    const apiKey = localStorage.getItem(`${provider}_api_key`) || '';

    console.log('AI Config:', { provider, hasKey: !!apiKey });

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
            return google('gemini-2.5-flash');
        }
        case 'openai': {
            const openai = createOpenAI({ apiKey });
            return openai.chat('gpt-4o-mini');
        }
        case 'openrouter': {
            // Use .chat() for OpenRouter (uses /chat/completions endpoint)
            const openrouter = createOpenAI({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1',
            });
            return openrouter.chat('google/gemini-2.5-flash-lite');
        }
        case 'groq': {
            // Use .chat() for Groq (uses /chat/completions endpoint)
            const groq = createOpenAI({
                apiKey,
                baseURL: 'https://api.groq.com/openai/v1',
            });
            return groq.chat('llama-3.1-8b-instant');
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

type ReminderToolInput = z.infer<typeof reminderToolSchema>;

const setReminderTool = tool({
    description: `Set check-ins for the user's focus session.
Use 'recurring' (default for focus sessions) to provide periodic check-ins throughout their work time - this keeps users accountable.
Use 'one-time' ONLY when user explicitly asks for a single reminder at a specific time (e.g., "remind me in exactly 30 min").
For focus sessions with a duration (e.g., "work for 1 hour"), ALWAYS use recurring with appropriate intervals.`,
    inputSchema: reminderToolSchema,
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
            system: systemInstruction,
            messages: messages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            tools: {
                setReminder: setReminderTool,
            },
        });

        console.log('AI SDK Response:', {
            text: result.text?.substring(0, 100),
            toolCalls: result.toolCalls || [],
        });

        // Extract reminder from tool calls
        let reminder: ReminderConfig | null = null;

        for (const toolCall of result.toolCalls || []) {
            if (toolCall.toolName === 'setReminder' && 'input' in toolCall) {
                const input = toolCall.input as ReminderToolInput;
                reminder = {
                    type: input.type,
                    minutes: input.minutes,
                    reason: input.reason,
                };
                console.log('📋 Reminder set via tool:', reminder);
            }
        }

        return {
            text: result.text || "I'm here to help you focus! What would you like to work on?",
            reminder,
        };
    } catch (error) {
        console.error('AI SDK error:', error);

        // Fallback: try without tools if tool calling fails
        try {
            console.log('Attempting fallback without tools...');
            const fallbackResult = await generateText({
                model,
                system: systemInstruction,
                messages: messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                })),
            });

            return {
                text: fallbackResult.text || "I'm here to help you focus!",
                reminder: null,
            };
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
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
        console.log('🔔 Getting initial response for:', userInput);
        const response = await callAI(conversationHistory);
        console.log('🔔 AI response:', { text: response.text?.substring(0, 50), reminder: response.reminder });
        conversationHistory.push({ role: 'assistant', content: response.text });

        // Store task if AI set a reminder (indicating it detected a task)
        if (response.reminder) {
            currentTask = userInput;
        } else {
            currentTask = null;
        }

        return response;
    } catch (error) {
        console.error("AI API error in getInitialResponse:", error);
        const isNoApiKey = error instanceof Error && error.message.includes('No API key');
        return {
            text: isNoApiKey ? NO_API_KEY_MESSAGE : `I'm having trouble connecting. Go to Settings (gear icon) and check your API key, then try again.`,
            reminder: null
        };
    }
};

export const continueChat = async (message: string): Promise<AIResponse> => {
    conversationHistory.push({ role: 'user', content: message });

    try {
        const response = await callAI(conversationHistory);
        conversationHistory.push({ role: 'assistant', content: response.text });

        // Update currentTask if AI set a reminder (indicating it detected a new task)
        if (response.reminder) {
            currentTask = message;
            console.log('Updated current task to:', currentTask);
        }

        return response;
    } catch (error) {
        console.error("AI API error in continueChat:", error);
        const isNoApiKey = error instanceof Error && error.message.includes('No API key');
        return {
            text: isNoApiKey ? NO_API_KEY_MESSAGE : "I'm having trouble responding right now. Let's try again in a moment.",
            reminder: null
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

    try {
        const result = streamText({
            model,
            system: systemInstruction,
            messages: conversationHistory.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            tools: {
                setReminder: setReminderTool,
            },
        });

        // Collect all chunks first
        let streamedText = '';
        let chunkCount = 0;
        
        try {
            for await (const chunk of result.textStream) {
                chunkCount++;
                streamedText += chunk;
            }
        } catch (streamError) {
            console.error('🔔 Error consuming stream:', streamError);
        }
        
        console.log('🔔 Total chunks received in service:', chunkCount);
        console.log('🔔 Streamed text length:', streamedText.length);

        // Now stream character by character with proper delays
        for (let i = 0; i < streamedText.length; i++) {
            onChunk(streamedText.slice(0, i + 1));
            await new Promise(resolve => setTimeout(resolve, 15));
        }

        // Get the full response to extract tool calls
        const fullResponse = await result.response;
        const assistantMessage = fullResponse.messages.find(m => m.role === 'assistant');
        
        // Extract text from assistant message
        let finalText = '';
        if (assistantMessage) {
            if (typeof assistantMessage.content === 'string') {
                finalText = assistantMessage.content;
            } else if (Array.isArray(assistantMessage.content)) {
                finalText = assistantMessage.content
                    .filter(item => item.type === 'text')
                    .map(item => 'text' in item ? item.text : '')
                    .join('');
            }
        }
        
        // If no chunks received, use full response text
        if (chunkCount === 0 && finalText) {
            console.log('🔔 No chunks received, using full response text');
            for (let i = 0; i < finalText.length; i++) {
                onChunk(finalText.slice(0, i + 1));
                await new Promise(resolve => setTimeout(resolve, 15));
            }
            streamedText = finalText;
        }
        
        // Extract reminder from tool calls
        let reminder: ReminderConfig | null = null;
        if (assistantMessage && Array.isArray(assistantMessage.content)) {
            for (const item of assistantMessage.content) {
                if (item.type === 'tool-call' && item.toolName === 'setReminder') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const toolCall = item as any;
                    if (toolCall.args && typeof toolCall.args === 'object') {
                        reminder = {
                            type: toolCall.args.type,
                            minutes: toolCall.args.minutes,
                            reason: toolCall.args.reason,
                        };
                    }
                }
            }
        }

        // Store in conversation history
        conversationHistory.push({ role: 'assistant', content: streamedText || finalText });
        
        // Store task if AI set a reminder
        if (reminder) {
            currentTask = userInput;
        } else {
            currentTask = null;
        }

        return { text: streamedText || finalText, reminder };
    } catch (error) {
        console.error('Streaming error:', error);
        throw error;
    }
};

export const streamContinueChat = async (
    message: string,
    onChunk: StreamCallback
): Promise<AIResponse> => {
    conversationHistory.push({ role: 'user', content: message });

    const { provider, apiKey } = getConfig();
    const model = getModel(provider, apiKey);

    try {
        const result = streamText({
            model,
            system: systemInstruction,
            messages: conversationHistory.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            tools: {
                setReminder: setReminderTool,
            },
        });

        // Collect all chunks first
        let streamedText = '';
        let chunkCount = 0;
        
        try {
            for await (const chunk of result.textStream) {
                chunkCount++;
                streamedText += chunk;
            }
        } catch (streamError) {
            console.error('🔔 Error consuming stream:', streamError);
        }
        
        console.log('🔔 Total chunks received in service:', chunkCount);
        console.log('🔔 Streamed text length:', streamedText.length);

        // Now stream character by character with proper delays
        for (let i = 0; i < streamedText.length; i++) {
            onChunk(streamedText.slice(0, i + 1));
            await new Promise(resolve => setTimeout(resolve, 15));
        }

        // Get the full response to extract tool calls
        const fullResponse = await result.response;
        const assistantMessage = fullResponse.messages.find(m => m.role === 'assistant');
        
        // Extract text from assistant message
        let finalText = '';
        if (assistantMessage) {
            if (typeof assistantMessage.content === 'string') {
                finalText = assistantMessage.content;
            } else if (Array.isArray(assistantMessage.content)) {
                finalText = assistantMessage.content
                    .filter(item => item.type === 'text')
                    .map(item => 'text' in item ? item.text : '')
                    .join('');
            }
        }
        
        // If no chunks received, use full response text
        if (chunkCount === 0 && finalText) {
            console.log('🔔 No chunks received, using full response text');
            for (let i = 0; i < finalText.length; i++) {
                onChunk(finalText.slice(0, i + 1));
                await new Promise(resolve => setTimeout(resolve, 15));
            }
            streamedText = finalText;
        }
        
        // Extract reminder from tool calls
        let reminder: ReminderConfig | null = null;
        if (assistantMessage && Array.isArray(assistantMessage.content)) {
            for (const item of assistantMessage.content) {
                if (item.type === 'tool-call' && item.toolName === 'setReminder') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const toolCall = item as any;
                    if (toolCall.args && typeof toolCall.args === 'object') {
                        reminder = {
                            type: toolCall.args.type,
                            minutes: toolCall.args.minutes,
                            reason: toolCall.args.reason,
                        };
                    }
                }
            }
        }

        // Store in conversation history
        conversationHistory.push({ role: 'assistant', content: streamedText || finalText });
        
        // Update currentTask if AI set a reminder
        if (reminder) {
            currentTask = message;
            console.log('Updated current task to:', currentTask);
        }

        return { text: streamedText || finalText, reminder };
    } catch (error) {
        console.error('Streaming error:', error);
        throw error;
    }
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
            messages: [{ role: 'user', content: prompt }],
        });

        return result.text || "Just checking in! How's your progress? ✨";
    } catch (error) {
        console.error("AI API error in generateCheckinMessage:", error);
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
