import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuestHomePage from '../GuestHomePage';

const { previewMock, languageState, useAuthMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  languageState: { value: 'zh' as 'zh' | 'en' },
  useAuthMock: vi.fn(),
}));

vi.mock('../../api/publicAnalysis', () => ({
  publicAnalysisApi: {
    preview: (...args: unknown[]) => previewMock(...args),
  },
}));

vi.mock('../../contexts/UiLanguageContext', () => ({
  useI18n: () => ({
    language: languageState.value,
    t: (key: string) => key,
  }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../components/StockAutocomplete', () => ({
  StockAutocomplete: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    disabled?: boolean;
  }) => (
    <input
      aria-label="guest-stock-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}));

describe('GuestHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    languageState.value = 'zh';
    useAuthMock.mockReturnValue({
      loggedIn: false,
      isLoading: false,
    });
    window.history.replaceState(window.history.state, '', '/zh');
  });

  it('renders the minimalist guest funnel and generates a live preview snapshot', async () => {
    previewMock.mockResolvedValue({
      queryId: 'preview-q1',
      stockCode: 'AAPL',
      stockName: 'Apple',
      previewScope: 'guest',
      report: {
        meta: {
          queryId: 'preview-q1',
          stockCode: 'AAPL',
          stockName: 'Apple',
          reportType: 'brief',
          createdAt: '2026-04-14T10:00:00Z',
        },
        summary: {
          analysisSummary: '趋势延续但需要等待更好的介入点。',
          operationAdvice: '等待回踩',
          trendPrediction: '偏强震荡',
          sentimentScore: 72,
        },
      },
    });

    render(
      <MemoryRouter>
        <GuestHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('guest-home-page')).toBeInTheDocument();
    expect(screen.getByTestId('guest-home-page')).toHaveClass('w-full', 'min-h-[calc(100vh-80px)]', 'overflow-x-hidden', 'px-6', 'py-8');
    expect(screen.getByRole('heading', { name: 'WolfyStock 决策面板' })).toBeInTheDocument();
    expect(screen.getAllByText('输入股票代码，唤醒 AI 深度分析...').length).toBeGreaterThan(0);
    expect(screen.getByTestId('guest-home-search-card')).toHaveClass(
      'w-full',
      'bg-white/[0.02]',
      'backdrop-blur-3xl',
      'border-white/5',
      'rounded-[24px]',
      'p-6',
      'shadow-2xl',
    );
    expect(screen.getByRole('button', { name: '生成简版判断' })).toHaveClass(
      'shrink-0',
      'bg-white/[0.05]',
      'hover:bg-white/[0.1]',
      'border-white/10',
      'text-white',
      'rounded-xl',
      'px-6',
      'py-3.5',
    );
    expect(screen.queryByTestId('guest-home-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guest-home-frosted-lock')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成简版判断' })).toBeEnabled();
    expect(screen.getByTestId('guest-home-waiting-action')).toHaveClass('text-white/40');
    expect(screen.getByTestId('guest-home-waiting-trend')).toHaveClass('text-white/40');
    expect(screen.getByTestId('guest-home-waiting-chart')).toHaveClass('text-white/40');

    fireEvent.change(screen.getByLabelText('guest-stock-input'), { target: { value: 'AAPL' } });
    fireEvent.click(screen.getByRole('button', { name: '生成简版判断' }));

    await waitFor(() => {
      expect(previewMock).toHaveBeenCalledWith({
        stockCode: 'AAPL',
        stockName: undefined,
        reportType: 'brief',
      });
    });

    expect(await screen.findByText('趋势延续但需要等待更好的介入点。')).toBeInTheDocument();
    expect(screen.getByText('等待回踩')).toBeInTheDocument();
    expect(screen.getAllByText('偏强震荡').length).toBeGreaterThan(0);
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getAllByText('突破观察').length).toBeGreaterThan(0);
    expect(screen.getByText('AI 归因')).toBeInTheDocument();
  });

  it('renders the English minimalist guest funnel copy', () => {
    languageState.value = 'en';
    window.history.replaceState(window.history.state, '', '/en');

    render(
      <MemoryRouter>
        <GuestHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'WolfyStock Decision Console' })).toBeInTheDocument();
    expect(screen.getAllByText('Enter a ticker to wake up the AI analysis flow.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Generate snapshot' })).toBeInTheDocument();
    expect(screen.queryByTestId('guest-home-grid')).not.toBeInTheDocument();
  });

  it('redirects signed-in users away from /guest and back to home', async () => {
    useAuthMock.mockReturnValue({
      loggedIn: true,
      isLoading: false,
    });
    window.history.replaceState(window.history.state, '', '/guest');

    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location-path">{location.pathname}</div>;
    };

    render(
      <MemoryRouter initialEntries={['/guest']}>
        <Routes>
          <Route path="/guest" element={<><GuestHomePage /><LocationProbe /></>} />
          <Route path="/" element={<><div>home workspace</div><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('home workspace')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-path')).toHaveTextContent('/'));
    expect(screen.queryByTestId('guest-home-page')).not.toBeInTheDocument();
  });
});
