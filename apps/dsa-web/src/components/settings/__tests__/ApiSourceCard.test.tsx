import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '../../../i18n/core';
import { ApiSourceCard } from '../ApiSourceCard';

const zh = (key: string, vars?: Record<string, string | number | undefined>) => translate('zh', key, vars);

describe('ApiSourceCard', () => {
  it('renders endpoint and internal metadata with localized labels', () => {
    render(
      <ApiSourceCard
        testId="data-source-card-demo"
        label="Demo News API"
        kindLabel={zh('settings.dataSourceCustomKind')}
        validationLabel={zh('settings.dataSourceConfiguredPending')}
        validationTone="default"
        isConfigured
        capabilities={[zh('settings.dataSourceCapability.news')]}
        statusText={zh('settings.dataSourceStatusConfigured')}
        validationMessage={zh('settings.dataSourceValidationConfiguredOnly')}
        usedByText={`${zh('settings.dataSourceUsedByLabel')}: ${zh('settings.dataRouteName.news')}`}
        endpointText={`${zh('settings.dataSourceEndpointNameLabel')}: demo_news_api`}
        internalFlagText={`${zh('settings.dataSourceInternalFlagLabel')}: ${zh('settings.dataSourceInternalFlagExternal')}`}
        manageLabel={zh('settings.dataSourceEditAction')}
        validateLabel={zh('settings.dataSourceValidateAction')}
        onManage={vi.fn()}
        onValidate={vi.fn()}
      />,
    );

    const card = screen.getByTestId('data-source-card-demo');
    expect(card).toHaveAttribute('data-layout', 'row');
    expect(card).toHaveTextContent(`${zh('settings.dataSourceEndpointNameLabel')}: demo_news_api`);
    expect(card).toHaveTextContent(`${zh('settings.dataSourceInternalFlagLabel')}: ${zh('settings.dataSourceInternalFlagExternal')}`);
    expect(card).toHaveTextContent(`${zh('settings.dataSourceUsedByLabel')}: ${zh('settings.dataRouteName.news')}`);
  });

  it('invokes manage and validate actions', () => {
    const onManage = vi.fn();
    const onValidate = vi.fn();

    render(
      <ApiSourceCard
        testId="data-source-card-demo"
        label="Demo News API"
        kindLabel={zh('settings.dataSourceCustomKind')}
        validationLabel={zh('settings.dataSourceConfiguredPending')}
        validationTone="default"
        isConfigured
        capabilities={[zh('settings.dataSourceCapability.news')]}
        statusText={zh('settings.dataSourceStatusConfigured')}
        validationMessage={zh('settings.dataSourceValidationConfiguredOnly')}
        usedByText={`${zh('settings.dataSourceUsedByLabel')}: ${zh('settings.dataRouteName.news')}`}
        endpointText={`${zh('settings.dataSourceEndpointNameLabel')}: demo_news_api`}
        internalFlagText={`${zh('settings.dataSourceInternalFlagLabel')}: ${zh('settings.dataSourceInternalFlagExternal')}`}
        manageLabel={zh('settings.dataSourceEditAction')}
        validateLabel={zh('settings.dataSourceValidateAction')}
        onManage={onManage}
        onValidate={onValidate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: zh('settings.dataSourceEditAction') }));
    fireEvent.click(screen.getByRole('button', { name: zh('settings.dataSourceValidateAction') }));

    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenCalledTimes(1);
  });
});
