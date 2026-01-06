
export type AIProvider = 'gemini' | 'openrouter' | 'groq';

interface AIConfig {
    provider: AIProvider;
    apiKey: string;
}

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

const systemInstruction = `You are Focus Fairy, a gentle assistant that helps users stay focused.

**RULES**:
- Keep responses under 30 words. Be warm and brief.
- No numbered lists, bullet points, or special formatting like brackets or asterisks.
- Your ONLY job is to help the user focus on their task.
- If the user hasn't mentioned a specific task yet (just greetings like "hi", "hello"), warmly ask what they'd like to focus on today.
- If the user mentions a task (like "reply to emails", "study for exam", "write report"), acknowledge it and encourage them.
- If the user asks to be reminded/checked on, acknowledge it warmly.
- If the user asks something completely unrelated (trivia, coding help, etc.), kindly say you're just here to help them focus.

**CHECK-IN TIMER**: To set a reminder, write INTERVAL: followed by minutes at the very end. Example: "INTERVAL: 5". Only include this when the user explicitly asks for a reminder or at the very start of a task.`;

const getConfig = (): AIConfig => {
    const provider = (localStorage.getItem('ai_provider') as AIProvider) || 'gemini';
    const apiKey = localStorage.getItem(`${provider}_api_key`) || '';
    
    console.log('AI Config:', { provider, hasKey: !!apiKey });
    
    if (!apiKey) {
        throw new Error(`No API key found for ${provider}. Please add your API key.`);
    }
    
    return { provider, apiKey };
};

const parseInterval = (responseText: string): { cleanText: string; interval: number | null } => {
    // Match various formats: INTERVAL: 15, [INTERVAL: 15], (INTERVAL: 15), *INTERVAL: 15*, etc.
    const intervalRegex = /[\[\(\*\s]*INTERVAL:\s*(\d+)[\]\)\*\s]*/gi;
    const matches = responseText.match(intervalRegex);
    
    let interval: number | null = null;
    let cleanText = responseText;
    
    if (matches) {
        // Extract the number from the first match
        const numberMatch = matches[0].match(/(\d+)/);
        if (numberMatch) {
            interval = parseInt(numberMatch[1], 10);
        }
        // Remove ALL interval markers from the text
        cleanText = responseText.replace(intervalRegex, '').trim();
    }
    
    // Also clean up any leftover brackets or formatting artifacts
    cleanText = cleanText.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '').trim();
    
    return { cleanText, interval };
};

// Store conversation history for providers that don't have native chat
let conversationHistory: ChatMessage[] = [];
// Track the actual task extracted from conversation (not just initial input)
let currentTask: string | null = null;

export const resetConversation = () => {
    conversationHistory = [];
    currentTask = null;
};

export const getCurrentTask = (): string | null => currentTask;

const MAX_INTERVAL_MINUTES = 180; // 3 hours

// Extract explicit time requests from user message (e.g., "remind me in 5 minutes")
// Returns time in minutes (no minimum - user gets what they ask for)
export const extractTimeFromMessage = (message: string): number | null => {
    // Check for seconds first
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
                const minutes = seconds / 60;
                console.log(`⏱️ Extracted ${seconds} seconds (${minutes.toFixed(3)} minutes)`);
                return Math.min(minutes, MAX_INTERVAL_MINUTES);
            }
        }
    }
    
    // Check for minutes
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
                console.log(`⏱️ Extracted ${minutes} minutes`);
                return Math.min(minutes, MAX_INTERVAL_MINUTES);
            }
        }
    }
    
    return null;
};

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
            return match[1].replace(/\s+in\s+\d+\s*(minutes?|mins?|hours?|hrs?)/i, '').trim();
        }
    }
    
    // If the message is long enough and not a greeting, it might be a task description
    if (message.length > 15 && !isGreeting(message)) {
        return message;
    }
    
    return null;
};

const callGemini = async (apiKey: string, messages: ChatMessage[]): Promise<string> => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    
    // Convert messages to Gemini format
    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
    }));
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
            systemInstruction: systemInstruction,
        }
    });
    
    return response.text || '';
};

const callOpenRouter = async (apiKey: string, messages: ChatMessage[]): Promise<string> => {
    console.log('Calling OpenRouter API...');
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Focus Fairy'
            },
            body: JSON.stringify({
                model: 'mistralai/mistral-7b-instruct',
                messages: [
                    { role: 'system', content: systemInstruction },
                    ...messages
                ]
            })
        });
        
        console.log('OpenRouter response status:', response.status);
        
        if (!response.ok) {
            const error = await response.text();
            console.error('OpenRouter error response:', error);
            throw new Error(`OpenRouter API error (${response.status}): ${error}`);
        }
        
        const data = await response.json();
        console.log('OpenRouter response data:', data);
        return data.choices[0]?.message?.content || '';
    } catch (error) {
        console.error('OpenRouter fetch error:', error);
        throw error;
    }
};

const callGroq = async (apiKey: string, messages: ChatMessage[]): Promise<string> => {
    console.log('Calling Groq API...');
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemInstruction },
                    ...messages
                ]
            })
        });
        
        console.log('Groq response status:', response.status);
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Groq error response:', error);
            throw new Error(`Groq API error (${response.status}): ${error}`);
        }
        
        const data = await response.json();
        console.log('Groq response received');
        return data.choices[0]?.message?.content || '';
    } catch (error) {
        console.error('Groq fetch error:', error);
        throw error;
    }
};

const callProvider = async (messages: ChatMessage[]): Promise<string> => {
    const { provider, apiKey } = getConfig();
    
    switch (provider) {
        case 'gemini':
            return callGemini(apiKey, messages);
        case 'openrouter':
            return callOpenRouter(apiKey, messages);
        case 'groq':
            return callGroq(apiKey, messages);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
};

export const initializeChat = () => {
    conversationHistory = [];
};

export const getInitialResponse = async (userInput: string): Promise<{ text: string; interval: number | null }> => {
    // Check if the user input is a greeting or an actual task
    const userIsGreeting = isGreeting(userInput);
    const extractedTask = extractTask(userInput);
    
    let prompt: string;
    
    if (userIsGreeting) {
        // User just said hi - ask them what they want to focus on
        prompt = userInput;
        currentTask = null;
    } else if (extractedTask) {
        // User mentioned a specific task
        currentTask = extractedTask;
        prompt = `I want to focus on: ${userInput}`;
    } else {
        // Unclear - treat as potential task but ask for clarification
        prompt = userInput;
        currentTask = userInput.length > 10 ? userInput : null;
    }
    
    conversationHistory = [{ role: 'user', content: prompt }];
    
    try {
        console.log('Getting initial response. Is greeting:', userIsGreeting, 'Extracted task:', currentTask);
        const responseText = await callProvider(conversationHistory);
        console.log('Got response:', responseText.substring(0, 100) + '...');
        conversationHistory.push({ role: 'assistant', content: responseText });
        
        const { cleanText, interval } = parseInterval(responseText);
        
        return { text: cleanText, interval };
    } catch (error) {
        console.error("AI API error in getInitialResponse:", error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { text: `I'm having trouble connecting: ${errorMessage}. Please check your API key in Settings.`, interval: null };
    }
};

export const continueChat = async (message: string): Promise<{ text: string; interval: number | null }> => {
    // Try to extract a task from the message if we don't have one yet
    const extractedTask = extractTask(message);
    if (extractedTask && (!currentTask || extractedTask.length > 10)) {
        currentTask = extractedTask;
        console.log('Updated current task to:', currentTask);
    }
    
    conversationHistory.push({ role: 'user', content: message });
    
    try {
        const responseText = await callProvider(conversationHistory);
        conversationHistory.push({ role: 'assistant', content: responseText });
        
        const { cleanText, interval } = parseInterval(responseText);

        return { text: cleanText, interval };
    } catch (error) {
        console.error("AI API error in continueChat:", error);
        return { text: "I'm having trouble responding right now. Please try again in a moment.", interval: null };
    }
};

export const generateCheckinMessage = async (fallbackTask: string): Promise<string> => {
    // Use the extracted task from conversation, or fall back to the initial input
    const taskToUse = currentTask || fallbackTask;
    
    // Don't mention the task if it's just a greeting
    if (isGreeting(taskToUse)) {
        return "Hey! Just checking in. How's your focus going? ✨";
    }
    
    const prompt = `Generate a short, friendly check-in notification (under 15 words) for someone working on: "${taskToUse}". Don't use brackets or special formatting.`;
    
    try {
        const responseText = await callProvider([{ role: 'user', content: prompt }]);
        // Clean any potential formatting from the response
        const { cleanText } = parseInterval(responseText);
        return cleanText || "Just checking in! How's your progress? ✨";
    } catch (error) {
        console.error("AI API error in generateCheckinMessage:", error);
        return `How's your progress going? Keep it up! ✨`;
    }
};

