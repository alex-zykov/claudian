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
  ProviderSettingsTabRenderer
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
import type { CursorWorkspaceServices } from '../app/CursorWorkspaceServices';
import {
  getCursorProviderSettings,
  updateCursorProviderSettings
} from '../settings';
import { CURSOR_PROVIDER_ICON } from './CursorProviderIcon';

const CURSOR_PROVIDER_ID = 'cursor' as const;

export const cursorSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const hostnameKey = context.plugin.storage.installationKey;
    const workspace = getCursorWorkspaceServices();

    const enablement: Omit<ProviderEnablementSettingOptions, 'container' | 'description'> = {
      getValue: () => getCursorProviderSettings(settingsBag).enabled,
      name: t('settings.providerEnablement.name', { provider: 'Cursor' }),
      onChange: async (enabled) => {
        if (!ProviderSettingsCoordinator.canApplyProviderEnablement(
          settingsBag,
          CURSOR_PROVIDER_ID,
          enabled,
        )) {
          lastProviderWarning.showFor();
          return;
        }

        let accepted = true;
        await context.plugin.runProviderExecutionTransition(
          [CURSOR_PROVIDER_ID],
          async () => context.plugin.mutateSettings((settings) => {
            accepted = ProviderSettingsCoordinator.applyProviderEnablement(
              settings,
              CURSOR_PROVIDER_ID,
              enabled,
            );
          }),
        );
        if (accepted) {
          lastProviderWarning.hide();
        } else {
          lastProviderWarning.showFor();
        }
        modelWarning.context.notifyProviderModelOptionsChanged(CURSOR_PROVIDER_ID);
      },
    };

    const installationContainer = container.createDiv();
    const lastProviderWarning = renderLastEnabledProviderWarning(container);

    const modelWarning = renderProviderModelEnablementWarning(container, context, {
      getHasEnabledModels: () => {
        const current = getCursorProviderSettings(settingsBag);
        return (current.visibleModels ?? current.currentCatalog?.models ?? []).length > 0;
      },
      getIsEnabled: () => getCursorProviderSettings(settingsBag).enabled,
      providerId: CURSOR_PROVIDER_ID,
      providerName: 'Cursor',
    });

    renderCLIInstallationSetting({
      cliName: 'Cursor',
      icon: CURSOR_PROVIDER_ICON,
      inspect: async () => {
        const settings = context.plugin.settings as unknown as Record<string, unknown>;
        const config = getCursorProviderSettings(settings);
        return probeCLIInstallation({
          path: await context.plugin.getResolvedProviderCliPath('cursor'),
          configuredPath: config.cliPathsByHost[hostnameKey] || config.cliPath,
          args: ['--version'],
          env: { ...process.env, ...getRuntimeEnvironmentVariables(settings, 'cursor') },
        });
      },
      container: installationContainer,
      enablement,
      getValue: () => {
        const current = getCursorProviderSettings(settingsBag);
        return current.cliPathsByHost[hostnameKey] ?? current.cliPath ?? '';
      },
      name: t('settings.cliPath.genericName'),
      onChange: async (value) => {
        const cliPathsByHost = {
          ...getCursorProviderSettings(settingsBag).cliPathsByHost,
        };
        if (value) {
          cliPathsByHost[hostnameKey] = value;
        } else {
          delete cliPathsByHost[hostnameKey];
        }
        const mutation = (settings: ClaudianSettings): void => {
          updateCursorProviderSettings(settings, {
            cliPath: '',
            cliPathsByHost,
          });
        };
        await context.plugin.applyProviderRuntimeSettings(
          [CURSOR_PROVIDER_ID],
          mutation,
          () => workspace.cliResolver.reset(),
        );
        modelWarning.context.notifyProviderModelOptionsChanged(CURSOR_PROVIDER_ID);
      },
      placeholder: process.platform === 'win32'
        ? '%USERPROFILE%\\.local\\bin\\agent.exe'
        : '~/.local/bin/agent',
      validate: validateCLIPath,
    });

    new Setting(container).setName('Models').setHeading();
    const modelPicker = renderProviderModelsSection(container, 'cursor', 'Cursor', workspace.modelCatalog!, () => modelWarning.refresh());

    renderEnvironmentSettingsSection({
      container,
      desc: t('settings.cursor.environment.desc'),
      heading: t('settings.environment'),
      name: t('settings.cursor.environment.name'),
      placeholder: 'CURSOR_API_KEY=\nCURSOR_AUTH_TOKEN=',
      plugin: context.plugin,
      renderCustomContextLimits: target => context.renderCustomContextLimits(target, CURSOR_PROVIDER_ID),
      scope: 'provider:cursor',
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

function getCursorWorkspaceServices(): CursorWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices(CURSOR_PROVIDER_ID) as CursorWorkspaceServices;
}
