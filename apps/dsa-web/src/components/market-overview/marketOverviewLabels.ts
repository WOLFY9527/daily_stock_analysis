import type { MarketOverviewItem } from '../../api/marketOverview';

export type MarketOverviewDisplayLabel = {
  primary: string;
  secondary?: string;
};

const LABEL_MAP: Record<string, MarketOverviewDisplayLabel> = {
  SPX: { primary: '标普500', secondary: 'SPX' },
  '^GSPC': { primary: '标普500', secondary: 'SPX' },
  'S&P 500': { primary: '标普500', secondary: 'SPX' },
  'NASDAQ': { primary: '纳斯达克', secondary: 'IXIC' },
  'IXIC': { primary: '纳斯达克', secondary: 'IXIC' },
  '^IXIC': { primary: '纳斯达克', secondary: 'IXIC' },
  'NASDAQ COMPOSITE': { primary: '纳斯达克', secondary: 'IXIC' },
  'DJI': { primary: '道琼斯', secondary: 'DJI' },
  'DJIA': { primary: '道琼斯', secondary: 'DJI' },
  '^DJI': { primary: '道琼斯', secondary: 'DJI' },
  'DOW JONES INDUSTRIAL AVERAGE': { primary: '道琼斯', secondary: 'DJI' },
  'US10Y': { primary: '美债10年期', secondary: 'US10Y' },
  '10Y YIELD': { primary: '美债10年期', secondary: 'US10Y' },
  'US 10Y': { primary: '美债10年期', secondary: 'US10Y' },
  DXY: { primary: '美元指数', secondary: 'DXY' },
  'US DOLLAR INDEX': { primary: '美元指数', secondary: 'DXY' },
  WTI: { primary: 'WTI原油', secondary: 'CL=F' },
  OIL: { primary: 'WTI原油', secondary: 'CL=F' },
  'WTI CRUDE': { primary: 'WTI原油', secondary: 'CL=F' },
  GOLD: { primary: '黄金主连', secondary: 'GC=F' },
  'GOLD FUTURES': { primary: '黄金主连', secondary: 'GC=F' },
  VIX: { primary: '恐慌指数', secondary: 'VIX' },
  FEDFUNDS: { primary: '联邦基金利率' },
  'FED FUNDS': { primary: '联邦基金利率' },
  'FEDERAL FUNDS RATE': { primary: '联邦基金利率' },
  BTC: { primary: '比特币', secondary: 'BTC' },
  BITCOIN: { primary: '比特币', secondary: 'BTC' },
};

function normalizeToken(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function resolveMarketOverviewDisplayLabel(item: Pick<MarketOverviewItem, 'symbol' | 'label'>): MarketOverviewDisplayLabel {
  const bySymbol = LABEL_MAP[normalizeToken(item.symbol)];
  if (bySymbol) {
    return bySymbol;
  }
  const byLabel = LABEL_MAP[normalizeToken(item.label)];
  if (byLabel) {
    return byLabel;
  }
  return {
    primary: item.label || item.symbol,
    secondary: item.symbol && item.symbol !== item.label ? item.symbol : undefined,
  };
}
