
export type AIProvider = 'gemini' | 'openrouter' | 'groq';

interface AIConfig {
    provider: AIProvider;
    apiKey: string;
}

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

const systemInstruction = `You are Focus Fairy, a gentle assistant that helps users stay focused on their task.

**RULES**:
- Keep responses under 30 words. Be warm and brief.
- No numbered lists or bullet points. Just natural, encouraging sentences.
- Your ONLY job is to help the user focus. Ask how their task is going, encourage them, or gently redirect them.
- If the user asks something unrelated to their task (off-topic questions, general knowledge, coding help, etc.), kindly say: "I'm just here to help you stay focused on your task! How's it going?"
- Never provide information, advice, or help outside of focus/productivity encouragement.

**CHECK-IN**: To set a check-in timer, add "INTERVAL: <minutes>" at the very end of your message. Only do this at the start or when the user mentions needing more/less time.`;

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
    const intervalRegex = /\n?INTERVAL: (\d+)/;
    const match = responseText.match(intervalRegex);

    if (match && match[1]) {
        const interval = parseInt(match[1], 10);
        const cleanText = responseText.replace(intervalRegex, '').trim();
        return { cleanText, interval };
    }

    return { cleanText: responseText, interval: null };
};

// Store conversation history for providers that don't have native chat
let conversationHistory: ChatMessage[] = [];

export const resetConversation = () => {
    conversationHistory = [];
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

export const getInitialResponse = async (task: string): Promise<{ text: string; interval: number | null }> => {
    const prompt = `My main task is: "${task}". Let's get started. Give me a short, encouraging welcome message and suggest a suitable check-in interval based on this task.`;
    
    conversationHistory = [{ role: 'user', content: prompt }];
    
    try {
        console.log('Getting initial response for task:', task);
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

export const generateCheckinMessage = async (task: string): Promise<string> => {
    const prompt = `A user is focused on the task: "${task}". Generate a single, short, encouraging check-in message for a browser notification. Keep it under 15 words. Example: "How's your progress on '${task}' coming along?"`;
    
    try {
        const responseText = await callProvider([{ role: 'user', content: prompt }]);
        return responseText || "Just checking in. How are you doing?";
    } catch (error) {
        console.error("AI API error in generateCheckinMessage:", error);
        return `How's the focus going on ${task}?`;
    }
};

