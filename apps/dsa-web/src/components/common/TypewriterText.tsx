import React, { useEffect, useState } from 'react';

type TypewriterTextProps = {
  text: string;
  speed?: number;
  testId?: string;
  as?: keyof React.JSX.IntrinsicElements;
  render?: (displayedText: string) => React.ReactNode;
};

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 15,
  testId,
  as = 'span',
  render,
}) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let index = 0;

    const timer = window.setInterval(() => {
      index += 1;
      setDisplayedText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, speed);

    return () => window.clearInterval(timer);
  }, [speed, text]);

  return React.createElement(
    as,
    { 'data-testid': testId },
    render ? render(displayedText) : displayedText,
  );
};
