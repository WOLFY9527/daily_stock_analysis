import React, { useCallback, useEffect, useRef } from 'react';

type TypewriterTextProps = {
  text: string;
  speed?: number;
  testId?: string;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  onComplete?: () => void;
};

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 15,
  testId,
  as = 'span',
  className,
  onComplete,
}) => {
  const textRef = useRef<HTMLElement | null>(null);
  const setTextRef = useCallback((node: HTMLElement | null) => {
    textRef.current = node;
  }, []);

  useEffect(() => {
    const node = textRef.current;
    if (!node) return;

    let index = 0;
    let lastTime = performance.now();
    let animationFrameId = 0;
    let isCancelled = false;

    node.innerHTML = '';

    const appendChunk = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\n') {
          node.appendChild(document.createElement('br'));
        } else {
          node.appendChild(document.createTextNode(char));
        }
      }
      node.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    const type = () => {
      if (isCancelled) return;

      const currentTime = performance.now();
      const elapsed = currentTime - lastTime;

      if (elapsed >= speed) {
        const nextChunkSize = Math.max(1, Math.floor(elapsed / speed));
        const chunk = text.slice(index, index + nextChunkSize);

        if (chunk) {
          appendChunk(chunk);
          index += chunk.length;
          lastTime = currentTime;
        }
      }

      if (index < text.length) {
        animationFrameId = window.requestAnimationFrame(type);
      } else {
        onComplete?.();
      }
    };

    animationFrameId = window.requestAnimationFrame(type);

    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [onComplete, speed, text]);

  const Component = as as 'div' | 'span';

  return (
    <Component
      ref={setTextRef}
      className={className}
      data-testid={testId}
    />
  );
};
