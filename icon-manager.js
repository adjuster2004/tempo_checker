// icon-manager.js - управление иконкой расширения

const ICON_PATHS = {
    enabled: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
    },
    disabled: {
        16: 'icons/icon16-disabled.png',
        48: 'icons/icon48-disabled.png',
        128: 'icons/icon128-disabled.png'
    }
};

class IconManager {
    constructor() {
        this.isManifestV3 = typeof chrome.action !== 'undefined';
        console.log('[IconManager] Manifest version:', this.isManifestV3 ? 'v3' : 'v2');
        this.createDisabledIcons();
    }

    // Создание отключенных версий иконок
    createDisabledIcons() {
        // В реальном приложении здесь можно динамически создавать серые иконки
        // или использовать заранее подготовленные файлы
        console.log('[IconManager] Используются стандартные иконки для отключенного состояния');
    }

    // Обновление иконки
    async updateIcon(isEnabled) {
        try {
            const iconSet = isEnabled ? ICON_PATHS.enabled : ICON_PATHS.disabled;

            // Проверяем доступность API
            if (this.isManifestV3) {
                // Manifest v3
                await chrome.action.setIcon({
                    path: iconSet
                });

                // Обновляем тултип
                await chrome.action.setTitle({
                    title: isEnabled
                        ? 'Tempo Checker - Включен'
                        : 'Tempo Checker - Отключен'
                });
            } else {
                // Manifest v2 (для обратной совместимости)
                await chrome.browserAction.setIcon({
                    path: iconSet
                });

                // Обновляем тултип
                await chrome.browserAction.setTitle({
                    title: isEnabled
                        ? 'Tempo Checker - Включен'
                        : 'Tempo Checker - Отключен'
                });
            }

            console.log(`[IconManager] Иконка обновлена: ${isEnabled ? 'ВКЛ' : 'ВЫКЛ'}`);

        } catch (error) {
            console.error('[IconManager] Ошибка обновления иконки:', error);
            // Не прерываем выполнение, т.к. это не критическая ошибка
        }
    }

    // Инициализация
    async initialize(pluginStateManager) {
        if (pluginStateManager) {
            // Устанавливаем начальную иконку
            await this.updateIcon(pluginStateManager.isEnabled());

            // Добавляем слушатель изменений состояния
            pluginStateManager.addListener((state) => {
                this.updateIcon(state.enabled);
            });
        }
    }
}

// Создаем глобальный экземпляр
const iconManager = new IconManager();

// Экспортируем
export { iconManager, IconManager };
