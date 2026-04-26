import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrandedLoadingScreen } from '../BrandedLoadingScreen';

vi.mock('../../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'app.workspaceEyebrow') {
        return '研究工作区';
      }
      return key;
    },
  }),
}));

describe('BrandedLoadingScreen', () => {
  it('renders the logo-led boot experience', () => {
    render(<BrandedLoadingScreen text="正在加载 WolfyStock..." subtext="加载中..." />);

    expect(screen.getByRole('status', { name: '正在加载 WolfyStock...' })).toBeInTheDocument();
    expect(screen.getByText('WolfyStock')).toBeInTheDocument();
    expect(screen.getByText('US • HK • CN')).toBeInTheDocument();
    expect(screen.getByText('研究工作区')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'WolfyStock logo' })).toHaveAttribute('src', '/wolfystock-logo-mark.png');
  });
});
