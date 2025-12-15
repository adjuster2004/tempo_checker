// Service Worker для Tempo Checker - основной файл

console.log('[TempoChecker] Background script загружен');

// Импорт модулей
import { tempoData } from './tempo-data.js';
import { initialize } from './background-init.js';
import { handleMessage } from './message-handler.js';
import { setupNotificationHandlers } from './notification-handler.js';
import { autoCheckManager } from './auto-check-manager.js';
import { checkAuthentication } from './auth-manager.js';
import { CONFIG } from './config.js'; // Импортируем конфиг из модуля

const JIRA_URL = CONFIG.JIRA.URL;

// Хранилище состояния плагина
let pluginState = {
    enabled: true,
    lastChange: null,
    disabledReason: null
};

// Инициализация расширения
chrome.runtime.onInstalled.addListener(() => {
    console.log('[TempoChecker] Расширение установлено');
    initialize();
    loadPluginState();
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[TempoChecker] Браузер запущен');
    initialize();
    loadPluginState();
});

// Обработчик сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[TempoChecker] Получено сообщение:', message.type);

    // Добавляем обработку сообщений о состоянии плагина
    if (message.type === 'GET_PLUGIN_STATE') {
        sendResponse({
            success: true,
            enabled: pluginState.enabled,
            lastChange: pluginState.lastChange,
            disabledReason: pluginState.disabledReason,
            message: pluginState.enabled ? 'Плагин включен' : 'Плагин отключен'
        });
        return true;
    }

    if (message.type === 'TOGGLE_PLUGIN') {
        try {
            const newState = togglePluginState();
            sendResponse({
                success: true,
                enabled: newState.enabled,
                lastChange: newState.lastChange,
                message: newState.enabled ? 'Плагин включен' : 'Плагин отключен'
            });

            // Показываем уведомление об изменении состояния
            showStateChangeNotification(newState.enabled);

            // Обновляем автоматические проверки
            updateAutoChecks(newState.enabled);

        } catch (error) {
            console.error('[TempoChecker] Ошибка переключения плагина:', error);
            sendResponse({
                success: false,
                error: error.message,
                enabled: pluginState.enabled
            });
        }
        return true;
    }

    // Обработка других сообщений
    handleMessage(message, sender, sendResponse);
    return true;
});

// Настройка обработчиков уведомлений
setupNotificationHandlers();

// Слушатель алермов для автоматической проверки
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'autoTempoCheck') {
        // Проверяем включен ли плагин
        if (!pluginState.enabled) {
            console.log('[TempoChecker] Плагин отключен, пропускаем автоматическую проверку');
            return;
        }

        console.log(`[TempoChecker] Автоматическая проверка запущена: ${alarm.name}`);

        try {
            // Запускаем проверку через autoCheckManager
            await autoCheckManager.runAutoCheck();
        } catch (error) {
            console.error('[TempoChecker] Ошибка при выполнении автоматической проверки:', error);
        }
    }
});

// Слушатель для уведомлений (при клике открываем соответствующую страницу)
chrome.notifications.onClicked.addListener((notificationId) => {
    console.log(`[TempoChecker] Кликнули по уведомлению: ${notificationId}`);

    // Определяем тип уведомления по содержимому
    chrome.notifications.get(notificationId, (notification) => {
        if (!notification) return;

        const title = notification.title || '';
        const message = notification.message || '';

        if (title.includes('авторизация') || message.includes('авторизация') ||
            title.includes('authorization') || message.includes('authorization')) {
            // Открываем Jira для авторизации
            chrome.tabs.create({
                url: JIRA_URL,
                active: true
            });
        } else if (title.includes('DNS') || title.includes('недоступен') ||
                   message.includes('DNS') || message.includes('недоступен')) {
            // Открываем Jira для проверки доступности
            chrome.tabs.create({
                url: JIRA_URL
            });
        } else if (title.includes('не отправили') || message.includes('не отправили')) {
            // Открываем страницу Tempo с текущей командой
            chrome.tabs.create({
                url: `${CONFIG.JIRA.URL}/secure/Tempo.jspa#/teams/team/${tempoData.selectedTeamId}/approvals`
            });
        } else if (title.includes('Плагин')) {
            // Для уведомлений о состоянии плагина ничего не делаем
            return;
        } else {
            // По умолчанию открываем Tempo
            chrome.tabs.create({
                url: `${CONFIG.JIRA.URL}/secure/Tempo.jspa#/teams/team/${tempoData.selectedTeamId}/approvals`
            });
        }
    });
});

// Слушатель закрытия уведомлений (для логирования)
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
    console.log(`[TempoChecker] Уведомление закрыто: ${notificationId}, пользователем: ${byUser}`);
});

// Слушатель закрытия вкладок (опционально, для очистки ресурсов)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log(`[TempoChecker] Вкладка закрыта: ${tabId}`);
});

// Периодическая проверка авторизации (каждые 30 минут)
setInterval(async () => {
    // Проверяем включен ли плагин
    if (!pluginState.enabled) {
        console.log('[TempoChecker] Плагин отключен, пропускаем периодическую проверку авторизации');
        return;
    }

    console.log('[TempoChecker] Периодическая проверка авторизации...');

    try {
        // Используем статически импортированную функцию
        const isAuthenticated = await checkAuthentication();

        console.log(`[TempoChecker] Периодическая проверка авторизации: ${isAuthenticated ? 'ДА' : 'НЕТ'}`);

        // Если авторизация пропала, принудительно проверяем
        if (!isAuthenticated && autoCheckManager.lastAuthCheck) {
            console.log('[TempoChecker] Авторизация пропала, сбрасываем кэш');
            autoCheckManager.lastAuthCheck = null;
        }

    } catch (error) {
        console.error('[TempoChecker] Ошибка периодической проверки авторизации:', error);
    }
}, 30 * 60 * 1000); // 30 минут

// Обработчик обновления вкладок (для отслеживания авторизации)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Проверяем включен ли плагин
    if (!pluginState.enabled) return;

    // Если открыта страница jira и она загрузилась
    if (tab.url && tab.url.includes(CONFIG.JIRA.URL) && changeInfo.status === 'complete') {
        console.log('[TempoChecker] Страница Jira загружена, проверяем авторизацию...');

        // Через небольшой таймаут проверяем авторизацию
        setTimeout(async () => {
            try {
                // Используем статически импортированную функцию
                const isAuthenticated = await checkAuthentication();

                if (isAuthenticated) {
                    console.log('[TempoChecker] Авторизация восстановлена после посещения Jira');
                    // Сбрасываем время последней проверки авторизации
                    autoCheckManager.lastAuthCheck = null;
                }
            } catch (error) {
                console.error('[TempoChecker] Ошибка проверки авторизации после обновления вкладки:', error);
            }
        }, 3000); // Ждем 3 секунды после загрузки страницы
    }
});

// Функции для управления состоянием плагина

// Загрузка состояния плагина из хранилища
async function loadPluginState() {
    try {
        const result = await chrome.storage.local.get('pluginState');
        if (result.pluginState) {
            pluginState = { ...pluginState, ...result.pluginState };
            console.log(`[TempoChecker] Состояние плагина загружено: ${pluginState.enabled ? 'ВКЛ' : 'ВЫКЛ'}`);

            // Обновляем автоматические проверки
            updateAutoChecks(pluginState.enabled);
        }
    } catch (error) {
        console.error('[TempoChecker] Ошибка загрузки состояния плагина:', error);
    }
}

// Сохранение состояния плагина
async function savePluginState() {
    try {
        await chrome.storage.local.set({ pluginState });
        console.log(`[TempoChecker] Состояние плагина сохранено: ${pluginState.enabled ? 'ВКЛ' : 'ВЫКЛ'}`);
    } catch (error) {
        console.error('[TempoChecker] Ошибка сохранения состояния плагина:', error);
    }
}

// Переключение состояния плагина
function togglePluginState() {
    pluginState.enabled = !pluginState.enabled;
    pluginState.lastChange = new Date().toISOString();
    pluginState.disabledReason = pluginState.enabled
        ? 'Включено пользователем'
        : 'Отключено пользователем';

    savePluginState();

    console.log(`[TempoChecker] Плагин ${pluginState.enabled ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}`);

    return { ...pluginState };
}

// Включение плагина
function enablePlugin() {
    if (pluginState.enabled) return pluginState;

    pluginState.enabled = true;
    pluginState.lastChange = new Date().toISOString();
    pluginState.disabledReason = null;

    savePluginState();

    console.log('[TempoChecker] Плагин ВКЛЮЧЕН');

    return { ...pluginState };
}

// Отключение плагина
function disablePlugin(reason = 'Отключено пользователем') {
    if (!pluginState.enabled) return pluginState;

    pluginState.enabled = false;
    pluginState.lastChange = new Date().toISOString();
    pluginState.disabledReason = reason;

    savePluginState();

    console.log(`[TempoChecker] Плагин ОТКЛЮЧЕН: ${reason}`);

    return { ...pluginState };
}

// Показать уведомление об изменении состояния плагина
async function showStateChangeNotification(isEnabled) {
    try {
        const title = isEnabled
            ? 'Tempo Checker: Плагин включен'
            : 'Tempo Checker: Плагин отключен';

        const message = isEnabled
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

        console.log(`[TempoChecker] Уведомление о состоянии плагина показано: ${isEnabled ? 'ВКЛ' : 'ВЫКЛ'}`);
    } catch (error) {
        console.error('[TempoChecker] Ошибка показа уведомления о состоянии плагина:', error);
    }
}

// Обновление автоматических проверок в зависимости от состояния плагина
function updateAutoChecks(isEnabled) {
    if (isEnabled) {
        // Включаем автоматические проверки
        console.log('[TempoChecker] Включаем автоматические проверки...');
        // setupDailyCheck() будет вызвана при инициализации
    } else {
        // Отключаем автоматические проверки
        console.log('[TempoChecker] Отключаем автоматические проверки...');
        chrome.alarms.clearAll();

        // Очищаем бейдж
        chrome.action.setBadgeText({ text: '' });
    }
}

// Экспортируем основные функции для тестирования
export {
    initialize,
    pluginState,
    loadPluginState,
    togglePluginState,
    enablePlugin,
    disablePlugin
};
