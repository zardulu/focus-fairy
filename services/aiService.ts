import { generateText, LanguageModel, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

export type AIProvider = 'gemini' | 'openrouter' | 'groq';

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

const systemInstruction = `You are Focus Fairy, a gentle assistant that helps users stay focused.

**RULES**:
- Keep responses under 30 words. Be warm and brief.
- No numbered lists, bullet points, or special formatting.
- Your ONLY job is to help the user focus on their task.
- If the user hasn't mentioned a specific task yet (just greetings like "hi", "hello"), warmly ask what they'd like to focus on today.
- If the user mentions a task, acknowledge it and encourage them.
- If the user asks something completely unrelated, kindly say you're just here to help them focus.

**IMPORTANT**: Use the setReminder tool to set appropriate check-ins based on the task type:
- For explicit time requests ("remind me in 5 minutes"), use one-time with the exact time requested
- For deep work/study sessions, use recurring with 25-45 minute intervals
- For quick tasks (emails, calls), use one-time with 10-15 minutes
- For ongoing/open-ended work, use recurring with 30 minute intervals
- Only set reminders when a clear task is mentioned, not for greetings`;

const getConfig = (): AIConfig => {
    const provider = (localStorage.getItem('ai_provider') as AIProvider) || 'gemini';
    const apiKey = localStorage.getItem(`${provider}_api_key`) || '';
    
    console.log('AI Config:', { provider, hasKey: !!apiKey });
    
    if (!apiKey) {
        throw new Error(`No API key found for ${provider}. Please add your API key.`);
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
    description: `Set a reminder or check-in for the user's focus session. 
Use 'one-time' for specific requests like "remind me in 5 minutes" or quick tasks.
Use 'recurring' for deep work sessions that need periodic check-ins.`,
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

// Check if input is just a greeting (not a real task)
const isGreeting = (text: string): boolean => {
    const greetings = ['hi', 'hello', 'hey', 'hola', 'sup', 'yo', 'greetings', 'howdy', 'good morning', 'good afternoon', 'good evening'];
    const normalized = text.toLowerCase().trim().replace(/[!.,?]+$/, '');
    return greetings.includes(normalized) || normalized.length < 4;
};

// Extract task from user message if it describes work to do
const extractTask = (message: string): string | null => {
    const taskIndicators = [
        /(?:working on|focus on|need to|want to|going to|have to|should|must|will)\s+(.+)/i,
        /(?:reply|respond|answer|write|read|study|finish|complete|prepare|review|edit|send|submit)\s+(.+)/i,
        /(?:remind me to|check.+on me|help me)\s+(.+)/i,
        /(?:my task is|the task is)\s+(.+)/i,
    ];
    
    for (const regex of taskIndicators) {
        const match = message.match(regex);
        if (match && match[1]) {
            return match[1].replace(/\s+in\s+\d+\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)/i, '').trim();
        }
    }
    
    // If the message is long enough and not a greeting, it might be a task description
    if (message.length > 15 && !isGreeting(message)) {
        return message;
    }
    
    return null;
};

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

// Determine default reminder based on task type
const getDefaultReminder = (userInput: string, task: string | null): ReminderConfig | null => {
    if (!task) return null;
    
    const input = userInput.toLowerCase();
    
    // DEBUG: "test" keyword triggers 10-second reminder for testing
    if (input.includes('test')) {
        console.log('🔔 DEBUG: Test keyword detected, setting 10-second reminder');
        return {
            type: 'one-time',
            minutes: 10 / 60, // 10 seconds
            reason: 'Debug test reminder',
        };
    }
    
    // Check for explicit time requests first
    const explicitTime = extractTimeFromMessage(userInput);
    if (explicitTime) {
        return {
            type: 'one-time',
            minutes: explicitTime,
            reason: 'User requested specific time',
        };
    }
    
    // Quick tasks - one-time reminder
    const quickTaskKeywords = ['email', 'reply', 'respond', 'call', 'message', 'text', 'quick', 'brief'];
    if (quickTaskKeywords.some(kw => input.includes(kw))) {
        return {
            type: 'one-time',
            minutes: 10,
            reason: 'Quick task detected',
        };
    }
    
    // Deep work - longer recurring intervals
    const deepWorkKeywords = ['study', 'studying', 'exam', 'thesis', 'essay', 'paper', 'research', 'code', 'coding', 'programming', 'writing', 'reading'];
    if (deepWorkKeywords.some(kw => input.includes(kw))) {
        return {
            type: 'recurring',
            minutes: 25,
            reason: 'Deep work/study session detected',
        };
    }
    
    // Default: recurring check-ins for any other task
    return {
        type: 'recurring',
        minutes: 15,
        reason: 'Default check-in for task',
    };
};

export const getInitialResponse = async (userInput: string): Promise<AIResponse> => {
    const userIsGreeting = isGreeting(userInput);
    const extractedTask = extractTask(userInput);
    
    let prompt: string;
    
    if (userIsGreeting) {
        prompt = userInput;
        currentTask = null;
    } else if (extractedTask) {
        currentTask = extractedTask;
        prompt = `I want to focus on: ${userInput}`;
    } else {
        prompt = userInput;
        currentTask = userInput.length > 10 ? userInput : null;
    }
    
    conversationHistory = [{ role: 'user', content: prompt }];
    
    try {
        console.log('🔔 Getting initial response. Is greeting:', userIsGreeting, 'Extracted task:', currentTask);
        const response = await callAI(conversationHistory);
        console.log('🔔 AI response received:', { text: response.text?.substring(0, 50), reminder: response.reminder });
        conversationHistory.push({ role: 'assistant', content: response.text });
        
        // If AI didn't set a reminder but we have a task, use smart defaults
        console.log('🔔 Checking if default reminder needed. AI reminder:', response.reminder, 'currentTask:', currentTask);
        if (!response.reminder && currentTask) {
            const defaultReminder = getDefaultReminder(userInput, currentTask);
            console.log('🔔 Default reminder generated:', defaultReminder);
            if (defaultReminder) {
                console.log('🔔 Using default reminder (AI did not set one):', defaultReminder);
                return {
                    text: response.text,
                    reminder: defaultReminder,
                };
            }
        }
        
        console.log('🔔 Returning response with reminder:', response.reminder);
        return response;
    } catch (error) {
        console.error("AI API error in getInitialResponse:", error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { 
            text: `I'm having trouble connecting: ${errorMessage}. Please check your API key in Settings.`, 
            reminder: null 
        };
    }
};

export const continueChat = async (message: string): Promise<AIResponse> => {
    const extractedTask = extractTask(message);
    if (extractedTask && (!currentTask || extractedTask.length > 10)) {
        currentTask = extractedTask;
        console.log('Updated current task to:', currentTask);
    }
    
    conversationHistory.push({ role: 'user', content: message });
    
    try {
        const response = await callAI(conversationHistory);
        conversationHistory.push({ role: 'assistant', content: response.text });
        
        // Check if user explicitly requested a reminder in this message
        const explicitTime = extractTimeFromMessage(message);
        if (!response.reminder && explicitTime) {
            console.log('📋 User requested explicit reminder time:', explicitTime);
            return {
                text: response.text,
                reminder: {
                    type: 'one-time',
                    minutes: explicitTime,
                    reason: 'User requested specific time',
                },
            };
        }
        
        return response;
    } catch (error) {
        console.error("AI API error in continueChat:", error);
        return { 
            text: "I'm having trouble responding right now. Please try again in a moment.", 
            reminder: null 
        };
    }
};

export const generateCheckinMessage = async (fallbackTask: string): Promise<string> => {
    const taskToUse = currentTask || fallbackTask;
    
    if (isGreeting(taskToUse)) {
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
