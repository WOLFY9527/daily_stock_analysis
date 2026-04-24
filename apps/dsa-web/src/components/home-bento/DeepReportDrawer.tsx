import type React from 'react';
import { Drawer } from '../common';
import { cn } from '../../utils/cn';
import { getToneTextClass, getToneTextStyle, type SignalTone } from './theme';

export type DeepReportMetric = {
  label: string;
  value: React.ReactNode;
  tone?: SignalTone;
  glow?: boolean;
};

export type DeepReportModule = {
  id: string;
  eyebrow: string;
  title: string;
  summary?: React.ReactNode;
  metrics: DeepReportMetric[];
  footnote?: React.ReactNode;
};

type DeepReportDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  modules: DeepReportModule[];
  testId?: string;
};

export const DeepReportDrawer: React.FC<DeepReportDrawerProps> = ({
  isOpen,
  onClose,
  title,
  modules,
  testId = 'home-bento-drawer',
}) => (
  <Drawer
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    width="max-w-[min(96vw,72rem)]"
  >
    <div
      data-testid={testId}
      className="space-y-6 rounded-l-[40px] rounded-r-[24px] border border-white/[0.08] bg-white/[0.02] p-6 text-white backdrop-blur-3xl sm:p-8"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        {modules.map((module) => (
          <section
            key={module.id}
            data-testid={`${testId}-${module.id}`}
            className="rounded-[32px] border border-white/[0.08] bg-black/36 p-6 backdrop-blur-3xl"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">{module.eyebrow}</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">{module.title}</h3>
            {module.summary ? (
              <p className="mt-3 text-sm leading-6 text-white/62">{module.summary}</p>
            ) : null}

            <div className="mt-6 space-y-3">
              {module.metrics.map((metric) => {
                const tone = metric.tone || 'neutral';
                return (
                  <div
                    key={`${module.id}-${metric.label}`}
                    className="rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-6 backdrop-blur-xl"
                  >
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{metric.label}</p>
                    <p
                      className={cn('mt-3 text-lg font-semibold', getToneTextClass(tone))}
                      style={getToneTextStyle(tone, metric.glow === true)}
                    >
                      {metric.value}
                    </p>
                  </div>
                );
              })}
            </div>

            {module.footnote ? (
              <p className="mt-6 text-[11px] uppercase tracking-[0.16em] text-white/34">{module.footnote}</p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  </Drawer>
);

export default DeepReportDrawer;
