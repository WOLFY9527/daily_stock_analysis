import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypewriterText } from '../TypewriterText';

describe('TypewriterText', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      writable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 24),
    });

    Object.defineProperty(window, 'cancelAnimationFrame', {
      writable: true,
      value: (handle: number) => window.clearTimeout(handle),
    });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reveals text in token-like chunks and auto-scrolls only while sticky follow is enabled', async () => {
    const autoScrollRef = { current: true };
    const scrollContainer = document.createElement('main');
    scrollContainer.id = 'chat-scroll-container';
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });
    document.body.appendChild(scrollContainer);

    render(
      <TypewriterText
        as="div"
        testId="typewriter"
        text="最新回复正在涌现"
        autoScrollRef={autoScrollRef}
      />
    );

    const node = screen.getByTestId('typewriter');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    const partialText = node.textContent ?? '';
    expect(partialText.length).toBeGreaterThan(0);
    expect(partialText.length).toBeLessThan('最新回复正在涌现'.length);
    expect(scrollContainer.scrollTop).toBe(scrollContainer.scrollHeight);

    scrollContainer.scrollTop = 0;
    autoScrollRef.current = false;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(node).toHaveTextContent('最新回复正在涌现');
    expect(scrollContainer.scrollTop).toBe(0);
    scrollContainer.remove();
  });
});
