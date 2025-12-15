// Модуль инициализации расширения

import { tempoData } from './tempo-data.js';
import { initializeStorage, loadData, saveData } from './storage-manager.js';
import { checkAuthentication } from './auth-manager.js';
import { setupDailyCheck } from './tempo-checker.js';
import { setupTabManager } from './tab-manager.js';
import { autoCheckManager } from './auto-check-manager.js';
import { pluginStateManager } from './plugin-state-manager.js';
import { iconManager } from './icon-manager.js';

async function initialize() {
    console.log('[TempoChecker] Инициализация...');

    try {
        await initializeStorage();
        await loadData();

        // Инициализируем менеджер состояния плагина
        await pluginStateManager.initialize();

        // Инициализируем менеджер иконок
        await iconManager.initialize(pluginStateManager);

        // ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА АВТОРИЗАЦИИ ПРИ ЗАПУСКЕ
        // Только если плагин включен
        if (pluginStateManager.isEnabled()) {
            await autoCheckManager.forceAuthCheck();
        }

        // Настраиваем автоматические проверки только если плагин включен
        if (pluginStateManager.isEnabled()) {
            setupDailyCheck();
        }

        setupTabManager();

        console.log('[TempoChecker] Инициализация завершена');

        // Также запускаем автопроверку сразу после запуска (опционально)
        // Только если плагин включен
        if (pluginStateManager.isEnabled()) {
            setTimeout(async () => {
                console.log('[TempoChecker] Запускаем проверку после запуска...');
                await autoCheckManager.runAutoCheck().catch(console.error);
            }, 5000);
        }

    } catch (error) {
        console.error('[TempoChecker] Ошибка инициализации:', error);
    }
}

export { initialize };
