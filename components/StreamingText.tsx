import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface StreamingTextProps {
    text: string;
    /** When true, particles emit from the trailing edge of the text (streaming in progress). */
    particlesActive: boolean;
    className?: string;
    style?: React.CSSProperties;
}

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    maxAge: number;
    size: number;
    kind: 'dark' | 'gold';
};

const MAX_PARTICLES = 600;
const SPAWN_PER_FRAME = 8;

function StreamingSandCanvas({
    active,
    origin,
}: {
    active: boolean;
    origin: { x: number; y: number } | null;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const rafRef = useRef<number>(0);
    const originRef = useRef<{ x: number; y: number } | null>(origin);
    const lastRef = useRef<number>(0);

    useLayoutEffect(() => {
        originRef.current = origin;
    }, [origin]);

    useEffect(() => {
        if (!active) {
            particlesRef.current = [];
            const c = canvasRef.current;
            if (c) {
                const ctx = c.getContext('2d');
                if (ctx) {
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.clearRect(0, 0, c.width, c.height);
                }
            }
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        window.addEventListener('resize', resize);

        const spawnBurst = (o: { x: number; y: number }) => {
            const arr = particlesRef.current;
            for (let i = 0; i < SPAWN_PER_FRAME; i++) {
                if (arr.length >= MAX_PARTICLES) {
                    arr.splice(0, arr.length - MAX_PARTICLES + 64);
                }
                arr.push({
                    x: o.x + (Math.random() - 0.5) * 4,
                    y: o.y + (Math.random() - 0.5) * 16,
                    vx: 1.4 + Math.random() * 3.8,
                    vy: (Math.random() - 0.5) * 2.4,
                    age: 0,
                    maxAge: 320 + Math.random() * 720,
                    size: 0.3 + Math.random() * 0.9,
                    kind: Math.random() > 0.12 ? 'dark' : 'gold',
                });
            }
        };

        const tick = (now: number) => {
            const prevFrame = lastRef.current || now;
            const dt = Math.min((now - prevFrame) / 1000, 0.064);
            lastRef.current = now;

            const w = window.innerWidth;
            const h = window.innerHeight;
            ctx.clearRect(0, 0, w, h);

            const emit = originRef.current;
            if (emit) {
                spawnBurst(emit);
            }

            const arr = particlesRef.current;
            for (let i = arr.length - 1; i >= 0; i--) {
                const p = arr[i];
                p.age += dt * 1000;
                if (p.age >= p.maxAge || p.x > w + 40) {
                    arr.splice(i, 1);
                    continue;
                }

                const lifeT = 1 - p.age / p.maxAge;
                p.x += p.vx * dt * 62;
                p.y += p.vy * dt * 62;
                p.vx += 0.55 * dt;
                p.vy += (Math.random() - 0.5) * 2.8 * dt;
                p.vy *= 0.992;

                const fade = lifeT * lifeT;
                const r = p.size * (0.32 + 0.68 * fade);

                if (p.kind === 'dark') {
                    ctx.fillStyle = `rgba(26,24,22,${fade * 0.78})`;
                } else {
                    ctx.fillStyle = `rgba(230,190,95,${fade * 0.55})`;
                }
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(0.22, r), 0, Math.PI * 2);
                ctx.fill();
            }

            rafRef.current = requestAnimationFrame(tick);
        };

        lastRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);

        return () => {
            window.removeEventListener('resize', resize);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
            }
            particlesRef.current = [];
        };
    }, [active]);

    return <canvas ref={canvasRef} className="streaming-sand-canvas" aria-hidden />;
}

const StreamingText: React.FC<StreamingTextProps> = ({
    text,
    particlesActive,
    className = '',
    style,
}) => {
    const markerRef = useRef<HTMLSpanElement>(null);
    const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

    useLayoutEffect(() => {
        if (!particlesActive) {
            setOrigin(null);
            return;
        }

        const update = () => {
            const el = markerRef.current;
            if (!el) {
                setOrigin(null);
                return;
            }
            const r = el.getBoundingClientRect();
            setOrigin({ x: r.left, y: r.top + r.height / 2 });
        };

        update();

        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [text, particlesActive]);

    const sand =
        particlesActive && origin != null && typeof document !== 'undefined'
            ? createPortal(
                  <StreamingSandCanvas active={particlesActive} origin={origin} />,
                  document.body
              )
            : null;

    return (
        <>
            <p className={`streaming-text-block ${className}`.trim()} style={style}>
                <span className="whitespace-pre-wrap">{text}</span>
                {particlesActive ? (
                    <span ref={markerRef} className="streaming-text-marker" aria-hidden />
                ) : null}
            </p>
            {sand}
        </>
    );
};

export default StreamingText;
