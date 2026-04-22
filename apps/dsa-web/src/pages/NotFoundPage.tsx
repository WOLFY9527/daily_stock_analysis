import type React from 'react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/common';
import { useI18n } from '../contexts/UiLanguageContext';
import { buildLocalizedPath } from '../utils/localeRouting';

const COPY = {
  zh: {
    documentTitle: '页面未找到 - WolfyStock',
    eyebrow: '页面状态',
    title: '页面未找到',
    body: '当前地址不存在或已经迁移。返回首页后，可以继续进入研究、持仓或回测区域。',
    cta: '返回首页',
  },
  en: {
    documentTitle: 'Page Not Found - WolfyStock',
    eyebrow: 'Page State',
    title: 'Page not found',
    body: 'This address does not exist or has moved. Go back home to continue into research, portfolio, or backtest areas.',
    cta: 'Back to home',
  },
} as const;

const NotFoundPage: React.FC = () => {
  const { language } = useI18n();
  const navigate = useNavigate();
  const copy = COPY[language];
  const homePath = buildLocalizedPath('/', language);

  useEffect(() => {
    document.title = copy.documentTitle;
  }, [copy.documentTitle]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="theme-panel-glass w-full max-w-2xl px-6 py-10 text-center sm:px-10">
        <p className="label-uppercase text-secondary-text">{copy.eyebrow}</p>
        <p className="mt-4 text-7xl font-normal tracking-[0.18em] text-foreground sm:text-8xl">404</p>
        <h1 className="mt-5 text-2xl font-normal tracking-[0.08em] text-foreground">{copy.title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-secondary-text">{copy.body}</p>
        <div className="mt-8 flex justify-center">
          <Button type="button" onClick={() => navigate(homePath)}>
            {copy.cta}
          </Button>
        </div>
      </section>
    </main>
  );
};

export default NotFoundPage;
