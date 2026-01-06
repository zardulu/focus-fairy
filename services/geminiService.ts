
import { GoogleGenAI, Chat, GenerateContentResponse } from '@google/genai';

const getAi = (): GoogleGenAI => {
    // Try localStorage first, then fall back to environment variable
    const apiKey = localStorage.getItem('gemini_api_key') || import.meta.env.VITE_API_KEY;
    if (!apiKey) {
        console.error("No API key found in localStorage or environment");
        throw new Error("API key not set. Please add your Gemini API key.");
    }
    console.log("API key found, initializing Gemini...");
    return new GoogleGenAI({ apiKey });
};

const systemInstruction = `You are FocusFlow, a friendly and encouraging AI assistant. Your goal is to help the user stay focused on their task.
Keep your responses concise, positive, and motivating. If the user asks for help, provide actionable, simple steps.

**IMPORTANT**: Based on the user's task or conversation, you can suggest a check-in interval.
- When the session starts, suggest an interval based on the task complexity.
- During the conversation, if the user mentions something that implies a change of pace (e.g., "taking a break", "almost done", "this is hard"), suggest a new interval.
- To suggest an interval, add a new line at the VERY END of your response in the format "INTERVAL: <minutes>". For example: "INTERVAL: 25".
- Only suggest an interval when it makes sense. Do not add it to every message.

Never break character. You are always FocusFlow.`;

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

export const createChatSession = (): Chat => {
    const ai = getAi();
    return ai.chats.create({
        model: 'gemini-2.0-flash',
        config: {
            systemInstruction: systemInstruction,
        },
    });
};

export const getInitialResponse = async (chat: Chat, task: string): Promise<{ text: string; interval: number | null }> => {
    const prompt = `My main task is: "${task}". Let's get started. Give me a short, encouraging welcome message and suggest a suitable check-in interval based on this task.`;
    try {
        const result = await chat.sendMessage({ message: prompt });
        const responseText = result.text ?? `Great! Let's focus on "${task}". You can do it!`;
        const { cleanText, interval } = parseInterval(responseText);
        
        let finalText = cleanText;
        if (interval) {
            finalText += `\n\n*(I'll check in with you in ${interval} minutes.)*`;
        }
        
        return { text: finalText, interval };
    } catch (error) {
        console.error("Gemini API error in getInitialResponse:", error);
        return { text: `I'm ready to help you with "${task}", but it seems I'm having a little trouble connecting. Let's try to proceed!`, interval: null };
    }
};

export const continueChat = async (chat: Chat, message: string): Promise<{ text: string; interval: number | null }> => {
    try {
        const result = await chat.sendMessage({ message });
        const responseText = result.text ?? "I'm not sure how to respond. Let's stay focused on your task!";
        const { cleanText, interval } = parseInterval(responseText);

        let finalText = cleanText;
        if (interval) {
            finalText += `\n\n*(Okay, I'll check in with you in ${interval} minutes.)*`;
        }

        return { text: finalText, interval };
    } catch (error) {
        console.error("Gemini API error in continueChat:", error);
        return { text: "I'm having trouble responding right now. Please try again in a moment.", interval: null };
    }
};

export const generateCheckinMessage = async (task: string): Promise<string> => {
    const ai = getAi();
    const prompt = `A user is focused on the task: "${task}". Generate a single, short, encouraging check-in message for a browser notification. Keep it under 15 words. Example: "How's your progress on '${task}' coming along?"`;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });
        return response.text ?? "Just checking in. How are you doing?";
    } catch (error) {
        console.error("Gemini API error in generateCheckinMessage:", error);
        return `How's the focus going on ${task}?`;
    }
};
