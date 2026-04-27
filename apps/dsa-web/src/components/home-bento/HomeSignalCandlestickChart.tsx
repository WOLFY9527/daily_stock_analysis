import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CandlestickChart } from 'echarts/charts';
import type {
  BarSeriesOption,
  CandlestickSeriesOption,
} from 'echarts/charts';
import type {
  ComposeOption,
  ECharts,
} from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  AxisPointerComponent,
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import type {
  AxisPointerComponentOption,
  GridComponentOption,
  MarkPointComponentOption,
  TooltipComponentOption,
} from 'echarts/components';
import { useElementSize } from '../../hooks/useElementSize';
import type { SignalTone } from './theme';

echarts.use([
  CandlestickChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

export type DecisionChartTimeframeId = 'intraday' | 'swing' | 'position';

export type DecisionCandle = {
  close: number;
  high: number;
  label: string;
  low: number;
  open: number;
  volume: number;
};

export type DecisionChartTimeframe = {
  breakoutIndex: number;
  breakoutLabel: string;
  candles: DecisionCandle[];
  id: DecisionChartTimeframeId;
  label: string;
};

type HomeChartLocale = 'zh' | 'en';

type EChartsOption = ComposeOption<
  | AxisPointerComponentOption
  | BarSeriesOption
  | CandlestickSeriesOption
  | GridComponentOption
  | MarkPointComponentOption
  | TooltipComponentOption
>;

const BULL_CANDLE = '#10b981';
const BEAR_CANDLE = '#ef4444';
const VOLUME_BULL = 'rgba(16, 185, 129, 0.34)';
const VOLUME_BEAR = 'rgba(239, 68, 68, 0.3)';

function formatCompactVolume(value: number, locale: HomeChartLocale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatAxisPrice(value: number): string {
  return value.toFixed(2);
}

export const HomeSignalCandlestickChart: React.FC<{
  locale: HomeChartLocale;
  signalTone: SignalTone;
  timeframe: DecisionChartTimeframe;
}> = ({ locale, signalTone, timeframe }) => {
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();
  const chartRef = useRef<ECharts | null>(null);
  const isEnglish = locale === 'en';

  const option = useMemo<EChartsOption>(() => {
    const candles = timeframe.candles;
    const labels = candles.map((candle) => candle.label);
    const ohlc = candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]);
    const breakout = candles[timeframe.breakoutIndex] || candles[candles.length - 1];

    return {
      animation: false,
      backgroundColor: 'transparent',
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
      },
      grid: [
        {
          left: 42,
          right: 10,
          top: 12,
          height: '66%',
        },
        {
          left: 42,
          right: 10,
          top: '81%',
          height: '11%',
        },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(8, 11, 18, 0.92)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        padding: 14,
        textStyle: {
          color: '#F8FAFC',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 11,
        },
        extraCssText: 'border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.42);backdrop-filter:blur(14px);',
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params];
          const candleParam = items.find((item) => (item as { seriesType?: string }).seriesType === 'candlestick') as {
            dataIndex?: number;
          } | undefined;
          const index = candleParam?.dataIndex ?? 0;
          const candle = candles[index] || breakout;
          return [
            `<div style="font-size:11px;color:rgba(255,255,255,0.56);margin-bottom:8px;">${isEnglish ? 'Signal window' : '信号窗口'}</div>`,
            `<div style="font-size:14px;font-weight:700;margin-bottom:10px;">${candle.label}</div>`,
            `<div style="display:grid;grid-template-columns:auto auto;gap:6px 16px;">`,
            `<span style="color:rgba(255,255,255,0.62);">${isEnglish ? 'Open' : '开'}</span><span style="text-align:right;">${candle.open.toFixed(2)}</span>`,
            `<span style="color:rgba(255,255,255,0.62);">${isEnglish ? 'High' : '高'}</span><span style="text-align:right;">${candle.high.toFixed(2)}</span>`,
            `<span style="color:rgba(255,255,255,0.62);">${isEnglish ? 'Low' : '低'}</span><span style="text-align:right;">${candle.low.toFixed(2)}</span>`,
            `<span style="color:rgba(255,255,255,0.62);">${isEnglish ? 'Close' : '收'}</span><span style="text-align:right;color:${candle.close >= candle.open ? BULL_CANDLE : BEAR_CANDLE};">${candle.close.toFixed(2)}</span>`,
            `<span style="color:rgba(255,255,255,0.62);">${isEnglish ? 'Volume' : '成交量'}</span><span style="text-align:right;">${formatCompactVolume(candle.volume, locale)}</span>`,
            `</div>`,
          ].join('');
        },
      },
      xAxis: [
        {
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          boundaryGap: true,
          data: labels,
          gridIndex: 0,
          splitLine: { show: false },
          type: 'category',
        },
        {
          axisLabel: {
            color: 'rgba(255,255,255,0.36)',
            fontSize: 10,
            interval: 0,
            margin: 12,
            formatter: (value: string, index: number) => {
              if (index === 0 || index === Math.floor(labels.length / 2) || index === labels.length - 1) {
                return value;
              }
              return '';
            },
          },
          axisLine: { show: false },
          axisTick: { show: false },
          boundaryGap: true,
          data: labels,
          gridIndex: 1,
          splitLine: { show: false },
          type: 'category',
        },
      ],
      yAxis: [
        {
          axisLabel: {
            color: 'rgba(255,255,255,0.34)',
            fontSize: 10,
            formatter: (value: number) => formatAxisPrice(value),
          },
          axisLine: { show: false },
          axisTick: { show: false },
          gridIndex: 0,
          scale: true,
          splitLine: {
            lineStyle: {
              color: 'rgba(255,255,255,0.06)',
              type: 'dashed',
            },
          },
          type: 'value',
        },
        {
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          gridIndex: 1,
          splitLine: { show: false },
          type: 'value',
        },
      ],
      series: [
        {
          type: 'candlestick',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ohlc,
          itemStyle: {
            borderColor: BULL_CANDLE,
            borderColor0: BEAR_CANDLE,
            color: BULL_CANDLE,
            color0: BEAR_CANDLE,
          },
          barMaxWidth: 12,
          markPoint: {
            animation: false,
            data: [
              {
                coord: [breakout.label, breakout.high],
                name: timeframe.breakoutLabel,
                value: timeframe.breakoutLabel,
              },
            ],
            itemStyle: {
              color: signalTone === 'bearish' ? BEAR_CANDLE : BULL_CANDLE,
              shadowBlur: 20,
              shadowColor: signalTone === 'bearish' ? 'rgba(239,68,68,0.34)' : 'rgba(16,185,129,0.34)',
            },
            label: {
              show: false,
            },
            symbol: 'pin',
            symbolKeepAspect: true,
            symbolOffset: [0, -10],
            symbolRotate: 0,
            symbolSize: 20,
          },
        },
        {
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: candles.map((candle) => ({
            value: candle.volume,
            itemStyle: {
              color: candle.close >= candle.open ? VOLUME_BULL : VOLUME_BEAR,
            },
          })),
          barGap: '0%',
          barCategoryGap: '18%',
          barWidth: '58%',
          emphasis: {
            disabled: true,
          },
        },
      ],
    };
  }, [isEnglish, locale, signalTone, timeframe]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || size.width <= 0 || typeof window === 'undefined') {
      return undefined;
    }

    if (!chartRef.current) {
      chartRef.current = echarts.init(node, undefined, { renderer: 'canvas' });
    }

    chartRef.current.setOption(option, { notMerge: true, lazyUpdate: true });
    chartRef.current.resize({ width: size.width, height: size.height || node.clientHeight });

    return undefined;
  }, [containerRef, option, size.height, size.width]);

  useEffect(() => () => {
    chartRef.current?.dispose();
    chartRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      data-chart-engine="echarts"
      data-testid="home-bento-decision-chart-workspace"
    />
  );
};
