import * as fs from 'node:fs';
import * as path from 'node:path';

import { Setting } from 'obsidian';

import { normalizeConfiguredCLIPath } from '@/core/process/cliPath';
import { probeCLIInstallation } from '@/core/providers/cli/CLIInstallationProbe';
import { getRuntimeEnvironmentVariables } from '@/core/providers/providerEnvironment';
import { renderCLIInstallationSetting } from '@/shared/settings/CLIInstallationSetting';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderSettingsTabRenderer,
} from '../../../core/providers/types';
import type { ClaudianSettings } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import type { ProviderEnablementSettingOptions } from '../../../shared/settings/ProviderEnablementSetting';
import {
  renderLastEnabledProviderWarning,
  renderProviderModelEnablementWarning,
} from '../../../shared/settings/ProviderModelEnablementWarning';
import { renderProviderModelsSection } from '../../../shared/settings/ProviderModelsSection';
import type { GeminiWorkspaceServices } from '../app/GeminiWorkspaceServices';
import {
  getGeminiProviderSettings,
  updateGeminiProviderSettings,
} from '../settings';
import { GEMINI_PROVIDER_ICON } from './GeminiProviderIcon';

const GEMINI_PROVIDER_ID = 'gemini' as const;

export const geminiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = context.plugin.storage.installationKey;
    const workspace = getGeminiWorkspaceServices();

    const enablement: Omit<ProviderEnablementSettingOptions, 'container' | 'description'> = {
      getValue: () => getGeminiProviderSettings(settingsBag).enabled,
      name: t('settings.providerEnablement.name', { provider: 'Gemini' }),
      onChange: async (enabled) => {
        if (!ProviderSettingsCoordinator.canApplyProviderEnablement(
          settingsBag,
          GEMINI_PROVIDER_ID,
          enabled,
        )) {
          lastProviderWarning.showFor();
          return;
        }

        let accepted = true;
        await context.plugin.runProviderExecutionTransition(
          [GEMINI_PROVIDER_ID],
          async () => context.plugin.mutateSettings((settings) => {
            accepted = ProviderSettingsCoordinator.applyProviderEnablement(
              settings,
              GEMINI_PROVIDER_ID,
              enabled,
            );
          }),
        );
        if (accepted) {
          lastProviderWarning.hide();
        } else {
          lastProviderWarning.showFor();
        }
        modelWarning.context.notifyProviderModelOptionsChanged(GEMINI_PROVIDER_ID);
      },
    };

    const installationContainer = container.createDiv();
    const lastProviderWarning = renderLastEnabledProviderWarning(container);

    const modelWarning = renderProviderModelEnablementWarning(container, context, {
      getHasEnabledModels: () => {
        const current = getGeminiProviderSettings(settingsBag);
        return (current.visibleModels ?? current.currentCatalog?.models ?? []).length > 0;
      },
      getIsEnabled: () => getGeminiProviderSettings(settingsBag).enabled,
      providerId: GEMINI_PROVIDER_ID,
      providerName: 'Gemini',
    });

    renderCLIInstallationSetting({
      cliName: 'Gemini',
      icon: GEMINI_PROVIDER_ICON,
      inspect: async () => {
        const settings = context.plugin.settings as unknown as Record<string, unknown>;
        const config = getGeminiProviderSettings(settings);
        return probeCLIInstallation({
          path: await context.plugin.getResolvedProviderCliPath('gemini'),
          configuredPath: config.cliPathsByHost[hostnameKey] || config.cliPath,
          args: ['--version'],
          env: { ...process.env, ...getRuntimeEnvironmentVariables(settings, 'gemini') },
        });
      },
      container: installationContainer,
      enablement,
      getValue: () => {
        const current = getGeminiProviderSettings(settingsBag);
        return current.cliPathsByHost[hostnameKey] ?? current.cliPath ?? '';
      },
      name: t('settings.cliPath.genericName'),
      onChange: async (value) => {
        const cliPathsByHost = {
          ...getGeminiProviderSettings(settingsBag).cliPathsByHost,
        };
        if (value) {
          cliPathsByHost[hostnameKey] = value;
        } else {
          delete cliPathsByHost[hostnameKey];
        }
        const mutation = (settings: ClaudianSettings): void => {
          updateGeminiProviderSettings(settings, {
            cliPath: '',
            cliPathsByHost,
          });
        };
        await context.plugin.applyProviderRuntimeSettings(
          [GEMINI_PROVIDER_ID],
          mutation,
          () => workspace.cliResolver.reset(),
        );
        modelWarning.context.notifyProviderModelOptionsChanged(GEMINI_PROVIDER_ID);
      },
      placeholder: process.platform === 'win32'
        ? '%USERPROFILE%\\.local\\bin\\agy.exe'
        : '~/.local/bin/agy',
      validate: validateCLIPath,
    });

    new Setting(container).setName('Models').setHeading();
    const modelPicker = renderProviderModelsSection(container, 'gemini', 'Gemini', workspace.modelCatalog!, () => modelWarning.refresh());

    renderEnvironmentSettingsSection({
      container,
      desc: t('settings.gemini.environment.desc'),
      heading: t('settings.environment'),
      name: t('settings.gemini.environment.name'),
      placeholder: 'GEMINI_API_KEY=\nGOOGLE_API_KEY=',
      plugin: context.plugin,
      renderCustomContextLimits: target => context.renderCustomContextLimits(target, GEMINI_PROVIDER_ID),
      scope: 'provider:gemini',
    });
    return modelPicker;
  },
};

function validateCLIPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const expandedPath = normalizeConfiguredCLIPath(trimmed);
  if (!path.posix.isAbsolute(expandedPath) && !path.win32.isAbsolute(expandedPath)) {
    return t('settings.cliPath.validation.mustBeAbsolute');
  }
  try {
    if (!fs.existsSync(expandedPath)) {
      return t('settings.cliPath.validation.notExist');
    }
    if (!fs.statSync(expandedPath).isFile()) {
      return t('settings.cliPath.validation.notFile');
    }
    if (process.platform !== 'win32') {
      fs.accessSync(expandedPath, fs.constants.X_OK);
    }
  } catch {
    return process.platform === 'win32'
      ? t('settings.cliPath.validation.notAccessible')
      : t('settings.cliPath.validation.notExecutable');
  }
  return null;
}

function getGeminiWorkspaceServices(): GeminiWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(GEMINI_PROVIDER_ID) as GeminiWorkspaceServices;
}
