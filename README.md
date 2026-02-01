# Focus Fairy ✨

An AI-powered focus assistant that helps you stay on track with your tasks. Set your goal, chat with the AI for guidance, and receive intelligent check-in reminders to keep you focused. Supports multiple AI providers including Gemini, OpenAI, OpenRouter, and Groq.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **AI:** Vercel AI SDK with tool calling (Gemini, OpenAI, OpenRouter, Groq)
- **Validation:** Zod

## Run Locally

**Prerequisites:** Node.js (v18+)

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Start the dev server:

   ```bash
   npm run dev
   ```

3. Open the app in your browser and add an API key in **Settings** (gear/API key area). Keys are stored locally in your browser.
   - **Gemini:** [Google AI Studio](https://aistudio.google.com/apikey)
   - **OpenAI:** [OpenAI Platform](https://platform.openai.com/api-keys)
   - **OpenRouter:** [OpenRouter](https://openrouter.ai/keys)
   - **Groq:** [Groq Console](https://console.groq.com/keys)