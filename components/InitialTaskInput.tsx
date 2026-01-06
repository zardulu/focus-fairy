import React, { useState } from 'react';

interface InitialTaskInputProps {
    onTaskSubmit: (task: string) => void;
    isLoading: boolean;
    onApiKeyClick?: () => void;
}

const InitialTaskInput: React.FC<InitialTaskInputProps> = ({ onTaskSubmit, isLoading, onApiKeyClick }) => {
    const [task, setTask] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (task.trim() && !isLoading) {
            onTaskSubmit(task);
        }
    };

    return (
        <div 
            className="min-h-screen w-full flex flex-col items-center justify-center p-4 relative"
            style={{ backgroundColor: 'var(--bg-white)' }}
        >
            {/* Settings Button */}
            <button 
                onClick={onApiKeyClick}
                className="btn-dark absolute top-6 right-6"
            >
                Settings
            </button>

            {/* Main Content */}
            <div className="flex flex-col items-center w-full" style={{ maxWidth: '600px' }}>
                {/* Title */}
                <h1 
                    className="font-title text-4xl font-semibold italic mb-10"
                    style={{ color: 'var(--text-dark)' }}
                >
                    Focus Fairy
                </h1>

                {/* Fairy and Speech Bubble Container */}
                <div className="flex items-center w-full mb-8 gap-4">
                    {/* Fairy */}
                    <div className="fairy-container animate-float">
                        <img src="/fairy.svg" alt="Focus Fairy" />
                    </div>

                    {/* AI Speech Bubble */}
                    <div className="speech-bubble-ai animate-fadeIn">
                        <p 
                            className="text-sm leading-relaxed"
                            style={{ color: 'var(--text-dark)' }}
                        >
                            Hi! I'm your Focus Fairy ✨ What task would you like to focus on today? I'll help break it down into manageable steps.
                        </p>
                    </div>

                    {/* Navigation Arrows */}
                    <div className="nav-arrows">
                        <div className="nav-arrow" style={{ opacity: 0.3 }}>
                            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 6L6 1L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="nav-arrow" style={{ opacity: 0.3 }}>
                            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 2L6 7L11 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                    </div>
                </div>

                {/* Input Form */}
                <form 
                    onSubmit={handleSubmit} 
                    className="flex items-center gap-3 w-full"
                    style={{ paddingLeft: '100px' }}
                >
                    <input
                        type="text"
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        placeholder=""
                        className="input-field flex-1"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        className="btn-send"
                        disabled={isLoading || !task.trim()}
                    >
                        {isLoading ? (
                            <div 
                                className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                                style={{ borderColor: 'var(--text-dark)', borderTopColor: 'transparent' }}
                            />
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default InitialTaskInput;
