// auto-check-manager.js - менеджер автоматических проверок
import { tempoData } from './tempo-data.js';
import { checkAuthentication } from './auth-manager.js';
import { checkTempoStatus } from './tempo-checker.js';
import { pluginStateManager } from './plugin-state-manager.js';
import { CONFIG } from './config.js'; // Добавлен импорт конфигурации

class AutoCheckManager {
    constructor() {
        this.lastAutoCheck = null;
        this.autoCheckCount = 0;
        this.isAutoChecking = false;
        this.lastAuthCheck = null;
        this.logs = [];

        this.config = {
            authCheckInterval: 60000, // 1 минута
            maxRetries: 3,
            retryDelay: 5000,
            maxLogs: 100
        };
    }

    // Инициализация менеджера
    async initialize() {
        await this.loadStats();
        await this.loadLogs();
        console.log('[AutoCheck] Менеджер инициализирован');
        this.log('INFO', 'Менеджер автоматических проверок инициализирован');
    }

    // Запуск автоматической проверки
    async runAutoCheck() {
        // Проверяем, доступен ли pluginStateManager
        if (typeof pluginStateManager !== 'undefined' && pluginStateManager) {
            if (!pluginStateManager.isEnabled()) {
                this.log('INFO', 'Плагин отключен, пропускаем автоматическую проверку');
                return {
                    success: false,
                    error: 'Плагин отключен',
                    skipped: true,
                    pluginDisabled: true
                };
            }
        } else {
            // Если pluginStateManager недоступен, логируем предупреждение
            this.log('WARN', 'PluginStateManager недоступен, продолжаем проверку без проверки состояния плагина');
        }

        if (this.isAutoChecking) {
            this.log('WARN', 'Проверка уже выполняется, пропускаем');
            return { success: false, error: 'Проверка уже выполняется' };
        }

        // Проверяем состояние браузера
        if (!await this.isBrowserActive()) {
            this.log('INFO', 'Браузер не активен, пропускаем проверку');
            return { success: false, error: 'Браузер не активен', skipped: true };
        }

        this.isAutoChecking = true;
        this.autoCheckCount++;

        this.log('INFO', `Запуск автоматической проверки #${this.autoCheckCount}`, {
            checkNumber: this.autoCheckCount
        });

        try {
            // 1. ПРОВЕРЯЕМ АВТОРИЗАЦИЮ
            const now = new Date();
            const needsAuthCheck = !this.lastAuthCheck ||
                                  (now - new Date(this.lastAuthCheck)) > this.config.authCheckInterval;

            let isAuthenticated = tempoData.isAuthenticated;

            if (needsAuthCheck) {
                this.log('INFO', 'Проверяем авторизацию...');
                try {
                    isAuthenticated = await checkAuthentication();
                    this.log('INFO', `Авторизация: ${isAuthenticated ? 'ДА' : 'НЕТ'}`);
                } catch (authError) {
                    this.log('ERROR', 'Ошибка проверки авторизации', { error: authError.message });
                    isAuthenticated = false;

                    // Показываем уведомление об ошибке авторизации
                    await this.showErrorNotification(
                        'Ошибка авторизации',
                        `Не удалось проверить авторизацию: ${this.extractErrorMessage(authError)}`
                    );
                }

                this.lastAuthCheck = now.toISOString();
                tempoData.isAuthenticated = isAuthenticated;
            } else {
                this.log('DEBUG', 'Используем кэшированную авторизацию');
            }

            if (!isAuthenticated) {
                this.log('WARN', 'Авторизация отсутствует, пропускаем проверку');

                // Показываем уведомление об отсутствии авторизации
                await this.showAuthRequiredNotification();

                this.isAutoChecking = false;
                return {
                    success: false,
                    error: 'Требуется авторизация',
                    skipped: true,
                    requiresAuth: true
                };
            }

            this.log('INFO', 'Авторизация подтверждена, проверяем Tempo...');

            // 2. ЗАПУСК ПРОВЕРКИ TEMPO
            let result;
            try {
                result = await checkTempoStatus();
            } catch (tempoError) {
                this.log('ERROR', 'Ошибка при проверке статуса Tempo', { error: tempoError.message });

                // Показываем уведомление об ошибке
                await this.showErrorNotification(
                    'Ошибка проверки Tempo',
                    `Не удалось выполнить проверку: ${this.extractErrorMessage(tempoError)}`
                );

                result = {
                    success: false,
                    error: tempoError.message
                };
            }

            this.lastAutoCheck = new Date().toISOString();

            // Обработка результата проверки
            if (result.success) {
                if (result.count > 0) {
                    this.log('SUCCESS', `Проверка успешна: ${result.count} не отправили`, {
                        count: result.count
                    });
                    // Уведомление о неподтвержденных уже показано в checkTempoStatus
                } else {
                    this.log('INFO', 'Все отправили Tempo');
                }
            }
            // Если проверка не успешна
            else if (!result.success) {
                this.log('ERROR', 'Ошибка проверки Tempo', {
                    error: result.error,
                    checkNumber: this.autoCheckCount
                });

                // Если уведомление еще не показано (например, для сетевых ошибок)
                if (!result.error?.includes('DNS') && !result.error?.includes('недоступен')) {
                    await this.showErrorNotification(
                        'Ошибка получения данных',
                        result.error || 'Неизвестная ошибка'
                    );
                }
            }

            // Сохраняем статистику
            await this.saveStats();

            this.isAutoChecking = false;
            return result;

        } catch (error) {
            this.isAutoChecking = false;

            this.log('CRITICAL', 'Критическая ошибка при проверке', {
                error: error.message,
                stack: error.stack
            });

            // Показываем критическое уведомление
            await this.showErrorNotification(
                'Критическая ошибка',
                this.extractErrorMessage(error)
            );

            // Сохраняем статистику
            await this.saveStats();

            return {
                success: false,
                error: error.message,
                critical: true
            };
        }
    }

    // Запуск проверки с повторными попытками
    async runAutoCheckWithRetry(retryCount = 0) {
        try {
            return await this.runAutoCheck();
        } catch (error) {
            if (retryCount < this.config.maxRetries) {
                this.log('WARN', `Повторная попытка ${retryCount + 1}/${this.config.maxRetries}`, {
                    retryCount: retryCount + 1,
                    error: error.message,
                    delay: this.config.retryDelay
                });

                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return await this.runAutoCheckWithRetry(retryCount + 1);
            }

            this.log('ERROR', 'Исчерпаны все попытки проверки', {
                maxRetries: this.config.maxRetries,
                lastError: error.message
            });

            throw error;
        }
    }

    // Показать уведомление о необходимости авторизации
    async showAuthRequiredNotification() {
        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: CONFIG.NOTIFICATIONS.ICON_URL,
                title: 'Tempo Checker: Требуется авторизация',
                message: `Для автоматической проверки Tempo войдите в Jira по ссылке: ${CONFIG.JIRA.URL}`,
                priority: 2,
                requireInteraction: true
            });

            this.log('INFO', 'Уведомление о необходимости авторизации отправлено');
        } catch (error) {
            this.log('ERROR', 'Ошибка показа уведомления об авторизации', { error: error.message });
        }
    }

    // Общая функция показа уведомлений об ошибках
    async showErrorNotification(title, message) {
        const shortMessage = message.length > 100 ?
            message.substring(0, 100) + '...' :
            message;

        try {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: CONFIG.NOTIFICATIONS.ICON_URL,
                title: `Tempo Checker: ${title}`,
                message: shortMessage,
                priority: 2,
                requireInteraction: false
            });

            this.log('INFO', `Уведомление об ошибке показано: ${title}`, { message: shortMessage });
        } catch (error) {
            this.log('ERROR', 'Ошибка показа уведомления об ошибке', { error: error.message });
        }
    }

    // Извлечение читаемого сообщения об ошибке
    extractErrorMessage(error) {
        const errorStr = error.toString();
        const jiraDomain = CONFIG.JIRA.URL.replace('https://', '');
        const jiraDomainShort = jiraDomain.replace(/^https?:\/\//, '');

        if (errorStr.includes('DNS_PROBE_FINISHED_NXDOMAIN')) return `Не удалось найти домен ${jiraDomainShort}`;
        if (errorStr.includes('ERR_NAME_NOT_RESOLVED')) return `Домен ${jiraDomainShort} не найден`;
        if (errorStr.includes('this site can\'t be reached')) return 'Не удается получить доступ к сайту';
        if (errorStr.includes('сайт не доступен')) return 'Сайт временно недоступен';
        if (errorStr.includes('timeout') || errorStr.includes('таймаут')) return 'Таймаут подключения';
        if (errorStr.includes('Network Error') || errorStr.includes('сеть')) return 'Ошибка сети';

        return error.message || errorStr;
    }

    // Получить статистику автоматических проверок
    getStats() {
        return {
            totalChecks: this.autoCheckCount,
            lastCheck: this.lastAutoCheck,
            lastAuthCheck: this.lastAuthCheck
        };
    }

    // Сохранить статистику
    async saveStats() {
        try {
            const stats = {
                autoCheckCount: this.autoCheckCount,
                lastAutoCheck: this.lastAutoCheck,
                lastAuthCheck: this.lastAuthCheck
            };

            await chrome.storage.local.set({ autoCheckStats: stats });
            this.log('DEBUG', 'Статистика сохранена', { stats: stats });
        } catch (error) {
            this.log('ERROR', 'Ошибка сохранения статистики', { error: error.message });
        }
    }

    // Загрузить статистику
    async loadStats() {
        try {
            const data = await chrome.storage.local.get('autoCheckStats');
            if (data.autoCheckStats) {
                this.autoCheckCount = data.autoCheckStats.autoCheckCount || 0;
                this.lastAutoCheck = data.autoCheckStats.lastAutoCheck || null;
                this.lastAuthCheck = data.autoCheckStats.lastAuthCheck || null;

                this.log('INFO', 'Статистика загружена', { stats: data.autoCheckStats });
            }
        } catch (error) {
            this.log('ERROR', 'Ошибка загрузки статистики', { error: error.message });
        }
    }

    // Принудительная проверка авторизации
    async forceAuthCheck() {
        this.log('INFO', 'Принудительная проверка авторизации...');
        const isAuth = await checkAuthentication();
        tempoData.isAuthenticated = isAuth;
        this.lastAuthCheck = new Date().toISOString();

        this.log(isAuth ? 'INFO' : 'WARN',
            `Принудительная проверка авторизации: ${isAuth ? 'Успешно' : 'Не удалось'}`);

        return isAuth;
    }

    // Проверка активности браузера
    async isBrowserActive() {
        return new Promise((resolve) => {
            if (chrome.idle && chrome.idle.queryState) {
                chrome.idle.queryState(15, (state) => {
                    resolve(state === 'active');
                });
            } else {
                // Если API недоступно, предполагаем что браузер активен
                resolve(true);
            }
        });
    }

    // Логирование
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            checkNumber: this.autoCheckCount
        };

        // Консольное логирование
        const consoleMethod = level === 'ERROR' || level === 'CRITICAL' ? 'error' :
                             level === 'WARN' ? 'warn' :
                             level === 'INFO' ? 'info' : 'log';

        console[consoleMethod](`[${timestamp}] [AutoCheck/${level}] ${message}`, data || '');

        // Сохраняем логи в памяти
        this.logs.push(logEntry);
        if (this.logs.length > this.config.maxLogs) {
            this.logs.shift();
        }
    }

    // Загрузка логов из хранилища
    async loadLogs() {
        try {
            const result = await chrome.storage.local.get('errorLogs');
            if (result.errorLogs) {
                this.logs = [...result.errorLogs, ...this.logs].slice(-this.config.maxLogs);
            }
        } catch (error) {
            this.log('ERROR', 'Ошибка загрузки логов', { error: error.message });
        }
    }
}

// Создаем глобальный экземпляр менеджера
const autoCheckManager = new AutoCheckManager();

// Экспорт функций
export {
    autoCheckManager,
    AutoCheckManager
};
