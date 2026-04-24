import type React from 'react';
import { Drawer } from '../common';
import { getToneTextClass, getToneTextStyle, type SignalTone } from './theme';

export type PageBriefMetric = {
  label: string;
  value: React.ReactNode;
  tone?: SignalTone;
};

type PageBriefDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  summary: React.ReactNode;
  bullets: React.ReactNode[];
  metrics?: PageBriefMetric[];
  footnote?: React.ReactNode;
  testId?: string;
  width?: string;
};

export const PageBriefDrawer: React.FC<PageBriefDrawerProps> = ({
  isOpen,
  onClose,
  title,
  summary,
  bullets,
  metrics,
  footnote,
  testId,
  width = 'max-w-[min(92vw,38rem)]',
}) => (
  <Drawer
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    width={width}
  >
    <div data-testid={testId} className="space-y-5">
      <p className="text-sm leading-6 text-secondary-text">{summary}</p>

      {metrics?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => {
            const tone = metric.tone || 'neutral';
            return (
              <div
                key={`${metric.label}-${String(metric.value)}`}
                className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-3"
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-secondary-text">{metric.label}</p>
                <p
                  className={`mt-2 text-base font-semibold ${getToneTextClass(tone)}`}
                  style={getToneTextStyle(tone)}
                >
                  {metric.value}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-3">
        {bullets.map((bullet, index) => (
          <div
            key={index}
            className="rounded-[var(--theme-panel-radius-md)] border border-[var(--theme-panel-subtle-border)] bg-[var(--surface-2)]/45 px-4 py-3 text-sm leading-6 text-secondary-text"
          >
            {bullet}
          </div>
        ))}
      </div>

      {footnote ? (
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-text">{footnote}</p>
      ) : null}
    </div>
  </Drawer>
);
