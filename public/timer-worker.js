// Timer Web Worker - runs independently of main thread throttling
let timerId = null;
let timerType = null; // 'one-time' or 'recurring'

self.onmessage = function (e) {
    const { action, milliseconds, type } = e.data;

    switch (action) {
        case 'start':
            // Clear any existing timer
            if (timerId) {
                if (timerType === 'recurring') {
                    clearInterval(timerId);
                } else {
                    clearTimeout(timerId);
                }
            }

            timerType = type;

            if (type === 'recurring') {
                timerId = setInterval(() => {
                    self.postMessage({ type: 'tick' });
                }, milliseconds);
            } else {
                timerId = setTimeout(() => {
                    self.postMessage({ type: 'tick' });
                    timerId = null;
                    timerType = null;
                }, milliseconds);
            }
            break;

        case 'stop':
            if (timerId) {
                if (timerType === 'recurring') {
                    clearInterval(timerId);
                } else {
                    clearTimeout(timerId);
                }
                timerId = null;
                timerType = null;
            }
            break;
    }
};
