// plugin-state-manager.js - управление состоянием плагина

const STORAGE_KEY = 'pluginState';
const DEFAULT_STATE = {
    enabled: true,
    lastChange: null,
    disabledReason: null
};

class PluginStateManager {
    constructor() {
        this.state = { ...DEFAULT_STATE };
        this.listeners = [];
    }

    // Инициализация
    async initialize() {
        await this.loadState();
        console.log('[PluginState] Менеджер инициализирован. Состояние:', this.state.enabled ? 'ВКЛ' : 'ВЫКЛ');
        return this.state;
    }

    // Загрузка состояния из хранилища
    async loadState() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            if (result[STORAGE_KEY]) {
                this.state = { ...DEFAULT_STATE, ...result[STORAGE_KEY] };
            }
            return this.state;
        } catch (error) {
            console.error('[PluginState] Ошибка загрузки состояния:', error);
            return this.state;
        }
    }

    // Сохранение состояния
    async saveState() {
        try {
            await chrome.storage.local.set({
                [STORAGE_KEY]: this.state
            });
            console.log('[PluginState] Состояние сохранено:', this.state);
            this.notifyListeners();
        } catch (error) {
            console.error('[PluginState] Ошибка сохранения состояния:', error);
        }
    }

    // Включение плагина
    async enable(reason = 'Пользователь включил плагин') {
        this.state.enabled = true;
        this.state.lastChange = new Date().toISOString();
        this.state.disabledReason = null;
        await this.saveState();

        console.log('[PluginState] Плагин ВКЛЮЧЕН:', reason);

        // Уведомляем все модули о включении
        await this.notifyModules('enabled');

        return this.state;
    }

    // Отключение плагина
    async disable(reason = 'Пользователь отключил плагин') {
        this.state.enabled = false;
        this.state.lastChange = new Date().toISOString();
        this.state.disabledReason = reason;
        await this.saveState();

        console.log('[PluginState] Плагин ОТКЛЮЧЕН:', reason);

        // Уведомляем все модули об отключении
        await this.notifyModules('disabled');

        return this.state;
    }

    // Переключение состояния
    async toggle() {
        if (this.state.enabled) {
            return await this.disable('Пользователь переключил в состояние ВЫКЛ');
        } else {
            return await this.enable('Пользователь переключил в состояние ВКЛ');
        }
    }

    // Проверка включен ли плагин
    isEnabled() {
        return this.state.enabled;
    }

    // Получение текущего состояния
    getState() {
        return { ...this.state };
    }

    // Сброс к состоянию по умолчанию
    async reset() {
        this.state = { ...DEFAULT_STATE };
        await this.saveState();
        console.log('[PluginState] Состояние сброшено к настройкам по умолчанию');
        return this.state;
    }

    // Добавление слушателя изменений состояния
    addListener(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    // Уведомление слушателей
    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('[PluginState] Ошибка в слушателе:', error);
            }
        });
    }

    // Уведомление всех модулей о изменении состояния
    async notifyModules(state) {
        // Останавливаем/запускаем автоматические проверки
        if (state === 'disabled') {
            await this.stopAutoChecks();
        } else if (state === 'enabled') {
            await this.resumeAutoChecks();
        }
    }

    // Остановка автоматических проверок
    async stopAutoChecks() {
        try {
            // Очищаем все алермы
            await chrome.alarms.clearAll();
            console.log('[PluginState] Все автоматические проверки остановлены');

            // Очищаем бейдж
            chrome.action.setBadgeText({ text: '' });

        } catch (error) {
            console.error('[PluginState] Ошибка остановки проверок:', error);
        }
    }

    // Возобновление автоматических проверок
    async resumeAutoChecks() {
        try {
            // Перезапускаем настройку ежедневных проверок
            // Импортируем динамически, чтобы избежать циклических зависимостей
            const { setupDailyCheck } = await import('./tempo-checker.js');
            setupDailyCheck();

            console.log('[PluginState] Автоматические проверки возобновлены');

        } catch (error) {
            console.error('[PluginState] Ошибка возобновления проверок:', error);
        }
    }

    // Получение статистики
    async getStats() {
        const state = await this.loadState();
        return {
            enabled: state.enabled,
            lastChange: state.lastChange,
            disabledReason: state.disabledReason,
            currentTime: new Date().toISOString()
        };
    }

    // Показать уведомление об изменении состояния
    async showStateChangeNotification() {
        try {
            const title = this.state.enabled
                ? 'Tempo Checker: Плагин включен'
                : 'Tempo Checker: Плагин отключен';

            const message = this.state.enabled
                ? 'Автоматические проверки возобновлены'
                : 'Автоматические проверки приостановлены';

            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: title,
                message: message,
                priority: 1,
                requireInteraction: false
            });
        } catch (error) {
            console.error('[PluginState] Ошибка показа уведомления:', error);
        }
    }
}

// Создаем глобальный экземпляр
const pluginStateManager = new PluginStateManager();

// Экспортируем
export { pluginStateManager, PluginStateManager };
