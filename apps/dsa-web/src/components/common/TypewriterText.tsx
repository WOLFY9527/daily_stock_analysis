import React, { useCallback, useEffect, useRef } from 'react';

type TypewriterTextProps = {
  text: string;
  testId?: string;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  onComplete?: () => void;
  autoScrollRef?: React.RefObject<boolean>;
};

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  testId,
  as = 'span',
  className,
  onComplete,
  autoScrollRef,
}) => {
  const textRef = useRef<HTMLElement | null>(null);
  const renderedLengthRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  const setTextRef = useCallback((node: HTMLElement | null) => {
    textRef.current = node;
  }, []);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const node = textRef.current;
    if (!node) return;

    const renderText = (value: string) => {
      node.innerHTML = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    };

    if (text.length <= renderedLengthRef.current) {
      renderText(text);
      renderedLengthRef.current = text.length;
      onCompleteRef.current?.();
      return;
    }

    let animationFrameId = 0;
    let lastFrameTime = -24;

    const type = (timestamp: number) => {
      if (timestamp - lastFrameTime < 24) {
        animationFrameId = window.requestAnimationFrame(type);
        return;
      }
      lastFrameTime = timestamp;

      const chunkSize = Math.floor(Math.random() * 3) + 1;
      const targetLength = Math.min(renderedLengthRef.current + chunkSize, text.length);

      renderText(text.slice(0, targetLength));
      renderedLengthRef.current = targetLength;

      if (autoScrollRef?.current) {
        const scrollContainer = document.getElementById('chat-scroll-container');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }

      if (renderedLengthRef.current < text.length) {
        animationFrameId = window.requestAnimationFrame(type);
      } else {
        onCompleteRef.current?.();
      }
    };

    animationFrameId = window.requestAnimationFrame(type);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [autoScrollRef, text]);

  const Component = as as 'div' | 'span';

  return (
    <Component
      ref={setTextRef}
      className={className}
      data-testid={testId}
    />
  );
};
