import type { PortfolioDecimal } from '../types/portfolio';

const PORTFOLIO_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type DecimalSign = -1 | 0 | 1;

export const PORTFOLIO_ZERO: PortfolioDecimal = '0';

function isZeroDecimal(value: string): boolean {
  return value.replace('-', '').replace('.', '').split('').every((digit) => digit === '0');
}

function decimalSign(value: PortfolioDecimal): DecimalSign {
  if (isZeroDecimal(value)) {
    return 0;
  }
  return value.startsWith('-') ? -1 : 1;
}

function absoluteParts(value: PortfolioDecimal): [string, string] {
  const absolute = value.startsWith('-') ? value.slice(1) : value;
  const [whole, fraction = ''] = absolute.split('.');
  return [whole, fraction];
}

type ScaledDecimal = {
  unscaled: bigint;
  scale: number;
};

function asScaledDecimal(value: PortfolioDecimal): ScaledDecimal {
  const [whole, fraction] = absoluteParts(value);
  const digits = `${whole}${fraction}`;
  const unscaled = BigInt(`${value.startsWith('-') ? '-' : ''}${digits}`);
  return { unscaled, scale: fraction.length };
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function fromScaledDecimal(unscaled: bigint, scale: number): PortfolioDecimal {
  if (unscaled === 0n) {
    return PORTFOLIO_ZERO;
  }

  const negative = unscaled < 0n;
  const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function requireCanonicalPortfolioDecimal(value: PortfolioDecimal, operation: string): void {
  if (!isPortfolioDecimal(value)) {
    throw new Error(`Portfolio decimal ${operation} requires canonical decimal strings`);
  }
}

function compareMagnitude(left: PortfolioDecimal, right: PortfolioDecimal): DecimalSign {
  const [leftWhole, leftFraction] = absoluteParts(left);
  const [rightWhole, rightFraction] = absoluteParts(right);
  if (leftWhole.length !== rightWhole.length) {
    return leftWhole.length > rightWhole.length ? 1 : -1;
  }
  if (leftWhole !== rightWhole) {
    return leftWhole > rightWhole ? 1 : -1;
  }

  const digits = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(digits, '0');
  const normalizedRight = rightFraction.padEnd(digits, '0');
  if (normalizedLeft === normalizedRight) {
    return 0;
  }
  return normalizedLeft > normalizedRight ? 1 : -1;
}

export function isPortfolioDecimal(value: unknown): value is PortfolioDecimal {
  return typeof value === 'string'
    && PORTFOLIO_DECIMAL_PATTERN.test(value)
    && !(value.startsWith('-') && isZeroDecimal(value));
}

export function parsePortfolioDecimal(value: unknown): PortfolioDecimal | undefined {
  return isPortfolioDecimal(value) ? value : undefined;
}

export function requirePortfolioDecimal(value: unknown, field = 'Portfolio decimal'): PortfolioDecimal {
  const decimal = parsePortfolioDecimal(value);
  if (!decimal) {
    throw new Error(`${field} must be a canonical decimal string`);
  }
  return decimal;
}

export function comparePortfolioDecimals(left: PortfolioDecimal, right: PortfolioDecimal): DecimalSign {
  requireCanonicalPortfolioDecimal(left, 'comparison');
  requireCanonicalPortfolioDecimal(right, 'comparison');
  const leftSign = decimalSign(left);
  const rightSign = decimalSign(right);
  if (leftSign !== rightSign) {
    return leftSign > rightSign ? 1 : -1;
  }
  if (leftSign === 0) {
    return 0;
  }
  const magnitude = compareMagnitude(left, right);
  return leftSign === 1 ? magnitude : (magnitude * -1) as DecimalSign;
}

export function portfolioDecimalSign(value: PortfolioDecimal): DecimalSign {
  requireCanonicalPortfolioDecimal(value, 'sign');
  return decimalSign(value);
}

export function addPortfolioDecimals(...values: PortfolioDecimal[]): PortfolioDecimal {
  if (values.length === 0) {
    return PORTFOLIO_ZERO;
  }
  values.forEach((value) => requireCanonicalPortfolioDecimal(value, 'addition'));
  const scaled = values.map(asScaledDecimal);
  const scale = scaled.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const unscaled = scaled.reduce(
    (total, value) => total + value.unscaled * pow10(scale - value.scale),
    0n,
  );
  return fromScaledDecimal(unscaled, scale);
}

export function multiplyPortfolioDecimals(left: PortfolioDecimal, right: PortfolioDecimal): PortfolioDecimal {
  requireCanonicalPortfolioDecimal(left, 'multiplication');
  requireCanonicalPortfolioDecimal(right, 'multiplication');
  const leftScaled = asScaledDecimal(left);
  const rightScaled = asScaledDecimal(right);
  return fromScaledDecimal(
    leftScaled.unscaled * rightScaled.unscaled,
    leftScaled.scale + rightScaled.scale,
  );
}

export function formatPortfolioDecimal(
  value: PortfolioDecimal | null | undefined,
  options: { minimumFractionDigits?: number } = {},
): string {
  if (value == null || !isPortfolioDecimal(value)) {
    return '--';
  }
  const negative = value.startsWith('-');
  const [whole, fraction] = absoluteParts(value);
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const minimumFractionDigits = Math.max(0, options.minimumFractionDigits ?? 0);
  const displayedFraction = fraction.padEnd(minimumFractionDigits, '0');
  return `${negative ? '-' : ''}${groupedWhole}${displayedFraction ? `.${displayedFraction}` : ''}`;
}

export function absolutePortfolioDecimal(value: PortfolioDecimal): PortfolioDecimal {
  requireCanonicalPortfolioDecimal(value, 'absolute value');
  return value.startsWith('-') ? value.slice(1) : value;
}
