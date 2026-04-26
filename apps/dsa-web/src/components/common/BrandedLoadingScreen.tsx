import type React from 'react';
import { useI18n } from '../../contexts/UiLanguageContext';
import { BrandLogo } from './BrandLogo';

interface BrandedLoadingScreenProps {
  fading?: boolean;
  text?: string;
  subtext?: string;
}

export const BrandedLoadingScreen: React.FC<BrandedLoadingScreenProps> = ({
  fading = false,
  text = 'Loading WolfyStock...',
  subtext,
}) => {
  const { t } = useI18n();
  return (
    <div
      className={`app-boot-splash${fading ? ' is-fading' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <div className="app-boot-splash__inner">
        <p className="app-boot-splash__eyebrow">{t('app.workspaceEyebrow')}</p>
        <div className="app-boot-splash__logo-wrap">
          <span className="app-boot-splash__ring" aria-hidden="true" />
          <span className="app-boot-splash__ring app-boot-splash__ring--secondary" aria-hidden="true" />
          <svg
            className="app-boot-splash__chart"
            viewBox="0 0 160 48"
            aria-hidden="true"
            preserveAspectRatio="none"
          >
            <polyline
              className="app-boot-splash__chart-path"
              points="10,36 34,34 54,24 73,28 96,15 116,20 138,8 150,12"
            />
            <circle className="app-boot-splash__chart-dot" cx="150" cy="12" r="3.5" />
          </svg>
          <BrandLogo className="app-boot-splash__logo" />
        </div>
        <p className="app-boot-splash__wordmark">WolfyStock</p>
        <p className="app-boot-splash__market">US • HK • CN</p>

        <p className="app-boot-splash__text">{text}</p>
        {subtext ? <p className="app-boot-splash__subtext">{subtext}</p> : null}

        <div className="app-boot-splash__progress" aria-hidden="true">
          <span className="app-boot-splash__progress-bar" />
        </div>
      </div>
    </div>
  );
};
