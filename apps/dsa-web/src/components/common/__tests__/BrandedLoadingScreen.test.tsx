import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandedLoadingScreen } from '../BrandedLoadingScreen';

describe('BrandedLoadingScreen', () => {
  it('renders the quant terminal boot experience', () => {
    render(<BrandedLoadingScreen text="正在加载 WolfyStock..." subtext="加载中..." />);

    expect(screen.getByRole('status', { name: 'WolfyStock quant terminal boot sequence' })).toBeInTheDocument();
    expect(screen.getByText('WOLFYSTOCK')).toBeInTheDocument();
    expect(screen.getByText('INITIALIZING WOLFY AI CORE...')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'WolfyStock logo' })).toHaveAttribute('src', '/wolfystock-logo-mark.png');
  });
});
