// Обработчик сообщений расширения

import { tempoData } from './tempo-data.js';
import { loadData, saveSettings, saveData } from './storage-manager.js';
import { checkAuthentication } from './auth-manager.js';
import { checkTempoStatus, updateBadge, setupDailyCheck } from './tempo-checker.js';
import { closeParsingTab } from './tab-manager.js';
import {
    getTeamsList,
    findTeam,
    filterTeams,
    getTeamsCount,
    addTeam,
    removeTeam,
    clearTeamsCache
} from './teams-manager.js';
import { CONFIG } from './config.js'; // Импортируем конфиг из модуля

// Проверяем, загружен ли конфиг
if (!CONFIG) {
    console.error('[MessageHandler] CONFIG не загружен! Проверьте загрузку config.js');
    throw new Error('CONFIG не инициализирован');
}

// Получение иконки для уведомлений
function getNotificationIcon() {
    return CONFIG?.NOTIFICATIONS?.ICON_URL || 'icons/icon48.png';
}

// Получение настроек проверки по умолчанию
function getDefaultCheckSettings() {
    return {
        checkTime: CONFIG?.CHECK?.DEFAULT_CHECK_TIME || '17:00',
        checkInterval: CONFIG?.CHECK?.DEFAULT_CHECK_INTERVAL || 'daily',
        checkDays: CONFIG?.CHECK?.DEFAULT_CHECK_DAYS || ['mon', 'tue', 'wed', 'thu', 'fri']
    };
}

// Функция для создания безопасного URL для Jira
function getJiraHomeUrl() {
    return CONFIG?.URL_TEMPLATES?.JIRA_HOME ?
        CONFIG.URL_TEMPLATES.JIRA_HOME() :
        CONFIG?.JIRA?.URL;
}

// Получение полного URL для Tempo
function getTempoHomeUrl() {
    const jiraUrl = CONFIG?.JIRA?.URL;
    const tempoPath = CONFIG?.JIRA?.TEMPO_BASE_PATH || '/secure/Tempo.jspa';
    return jiraUrl ? jiraUrl + tempoPath : null;
}

// Получение Jira URL (основной домен)
function getJiraUrl() {
    return CONFIG?.JIRA?.URL;
}

// Генерация сообщения об ошибке авторизации
function getAuthErrorMessage() {
    const jiraUrl = CONFIG?.JIRA?.URL;
    return jiraUrl ? `Для проверки Tempo войдите в Jira по ссылке: ${jiraUrl}` : 'Требуется авторизация в Jira';
}

// Генерация сообщения об ошибке недоступности сайта
function getSiteUnavailableMessage() {
    if (!CONFIG?.JIRA?.URL) {
        return 'Сайт Jira недоступен. Проверьте подключение к интернету.';
    }
    const siteName = CONFIG.JIRA.URL.replace(/^https?:\/\//, '');
    return `Сайт ${siteName} недоступен. Проверьте подключение к интернету.`;
}

// Получение сообщения о необходимости авторизации
function getAuthRequiredMessage() {
    const jiraUrl = CONFIG?.JIRA?.URL;
    return jiraUrl ? `Требуется авторизация в ${jiraUrl}` : 'Требуется авторизация в Jira';
}

async function handleMessage(message, sender, sendResponse) {
    try {
        let response;

        console.log(`[MessageHandler] Обработка сообщения: ${message.type}`);

        switch (message.type) {
            case 'GET_TEMPO_DATA':
                console.log('[MessageHandler] Получение данных Tempo...');
                await loadData();
                response = {
                    success: true,
                    data: {
                        notSubmittedUsers: tempoData.notSubmittedUsers,
                        lastCheck: tempoData.lastCheck,
                        totalCount: tempoData.notSubmittedUsers.length,
                        teamId: tempoData.selectedTeamId,
                        teamName: tempoData.selectedTeamName
                    },
                    isAuthenticated: tempoData.isAuthenticated
                };
                break;

            case 'CHECK_TEMPO_NOW':
                console.log('[MessageHandler] Запуск проверки Tempo...', message.date ? `для даты: ${message.date}` : '');
                try {
                    const result = await checkTempoStatus(message.date);
                    response = {
                        ...result,
                        isAuthenticated: tempoData.isAuthenticated
                    };

                    // Логируем результат
                    if (!result.success) {
                        console.error(`[MessageHandler] Ошибка проверки Tempo: ${result.error}`);

                        // Отправляем уведомление об ошибке
                        if (result.error.includes('DNS') || result.error.includes('недоступен') || result.error.includes('timeout')) {
                            await showNotification(
                                'Tempo Checker: Сайт недоступен',
                                getSiteUnavailableMessage(),
                                true
                            );
                        } else if (result.error.includes('авторизация') || result.error.includes('authorization') || result.error.includes('unauthorized')) {
                            await showNotification(
                                'Tempo Checker: Требуется авторизация',
                                getAuthErrorMessage(),
                                true
                            );
                        } else {
                            await showNotification(
                                'Tempo Checker: Ошибка проверки',
                                `Не удалось получить данные: ${result.error}`,
                                false
                            );
                        }
                    }
                } catch (error) {
                    console.error('[MessageHandler] Критическая ошибка при проверке Tempo:', error);
                    response = {
                        success: false,
                        error: error.message,
                        isAuthenticated: tempoData.isAuthenticated
                    };

                    // Отправляем уведомление об ошибке
                    await showNotification(
                        'Tempo Checker: Критическая ошибка',
                        `Произошла ошибка при проверке: ${error.message}`,
                        false
                    );
                }
                break;

            case 'GET_TEAMS':
                console.log('[MessageHandler] Получение списка команд...');
                try {
                    const teams = await getTeamsList();
                    response = {
                        success: true,
                        teams: teams,
                        isAuthenticated: tempoData.isAuthenticated,
                        count: teams.length
                    };
                } catch (error) {
                    const errorId = Date.now();
                    console.error(`[MessageHandler] Ошибка #${errorId}:`, error);
                    sendResponse({
                        success: false,
                        error: `Ошибка #${errorId}: ${error.message}`,
                        errorType: error.name,
                        timestamp: new Date().toISOString()
                    });
                }
                break;

            case 'UPDATE_TEAM':
                console.log('[MessageHandler] Обновление команды:', message.teamId, message.teamName);
                if (message.teamId && message.teamName) {
                    tempoData.selectedTeamId = message.teamId;
                    tempoData.selectedTeamName = message.teamName;
                    await saveSettings();

                    // Очищаем кэш данных
                    tempoData.notSubmittedUsers = [];
                    await saveData();
                    updateBadge();

                    response = {
                        success: true,
                        teamId: tempoData.selectedTeamId,
                        teamName: tempoData.selectedTeamName
                    };
                } else {
                    response = {
                        success: false,
                        error: 'Не указана команда (teamId и teamName обязательны)'
                    };
                }
                break;

            case 'GET_SETTINGS':
                console.log('[MessageHandler] Получение настроек...');
                response = {
                    success: true,
                    settings: {
                        teamId: tempoData.selectedTeamId,
                        teamName: tempoData.selectedTeamName
                    },
                    isAuthenticated: tempoData.isAuthenticated
                };
                break;

            case 'CHECK_AUTH':
                console.log('[MessageHandler] Проверка авторизации...');
                try {
                    const isAuth = await checkAuthentication();
                    response = {
                        success: true,
                        isAuthenticated: isAuth,
                        message: isAuth ?
                            'Авторизация есть' :
                            getAuthRequiredMessage()
                    };
                } catch (error) {
                    console.error('[MessageHandler] Ошибка проверки авторизации:', error);
                    response = {
                        success: false,
                        isAuthenticated: false,
                        error: error.message,
                        message: 'Ошибка проверки авторизации'
                    };
                }
                break;

            case 'OPEN_JIRA':
                console.log('[MessageHandler] Открытие Jira...');
                const jiraUrl = getJiraHomeUrl();
                if (jiraUrl) {
                    chrome.tabs.create({ url: jiraUrl });
                    response = { success: true };
                } else {
                    response = {
                        success: false,
                        error: 'URL Jira не указан в конфигурации'
                    };
                }
                break;

            case 'REFRESH_TEAMS':
                console.log('[MessageHandler] Обновление списка команд...');

                try {
                    // Очищаем кэш и загружаем заново
                    clearTeamsCache();
                    const teams = await getTeamsList();

                    response = {
                        success: true,
                        teams: teams,
                        count: teams.length,
                        message: `Загружено ${teams.length} команд из файла`
                    };

                } catch (error) {
                    console.error('[MessageHandler] Ошибка обновления команд:', error);
                    response = {
                        success: false,
                        error: error.message,
                        teams: [],
                        message: 'Ошибка загрузки команд: ' + error.message
                    };
                }
                break;

            case 'CLOSE_PARSING_TAB':
                console.log('[MessageHandler] Закрытие вкладки парсинга...');
                await closeParsingTab();
                response = { success: true };
                break;

            case 'GET_TEAMS_COUNT':
                console.log('[MessageHandler] Получение количества команд...');
                try {
                    const count = await getTeamsCount();
                    response = {
                        success: true,
                        count: count
                    };
                } catch (error) {
                    response = {
                        success: false,
                        error: error.message,
                        count: 0
                    };
                }
                break;

            case 'CLEAR_TEAMS_CACHE':
                console.log('[MessageHandler] Очистка кэша команд...');
                clearTeamsCache();
                response = { success: true };
                break;

            case 'ADD_TEAM':
                console.log('[MessageHandler] Добавление команды:', message.team);
                try {
                    if (!message.team || !message.team.id || !message.team.name) {
                        throw new Error('Не указаны данные команды');
                    }

                    const addedTeam = await addTeam(message.team);
                    response = {
                        success: true,
                        team: addedTeam,
                        message: `Команда ${addedTeam.name} (ID: ${addedTeam.id}) добавлена`
                    };
                } catch (error) {
                    response = {
                        success: false,
                        error: error.message
                    };
                }
                break;

            case 'REMOVE_TEAM':
                console.log('[MessageHandler] Удаление команды:', message.teamId);
                try {
                    if (!message.teamId) {
                        throw new Error('Не указан ID команды');
                    }

                    const removedTeam = await removeTeam(message.teamId);
                    response = {
                        success: true,
                        team: removedTeam,
                        message: `Команда ${removedTeam.name} (ID: ${removedTeam.id}) удалена`
                    };
                } catch (error) {
                    response = {
                        success: false,
                        error: error.message
                    };
                }
                break;

            case 'SEARCH_TEAMS':
                console.log('[MessageHandler] Поиск команд:', message.searchTerm);
                try {
                    const filteredTeams = await filterTeams(message.searchTerm);
                    response = {
                        success: true,
                        teams: filteredTeams,
                        count: filteredTeams.length
                    };
                } catch (error) {
                    response = {
                        success: false,
                        error: error.message,
                        teams: []
                    };
                }
                break;

            case 'SAVE_TEAMS':
                console.log('[MessageHandler] Сохранение команд...', message.teams?.length || 0);
                try {
                    if (message.teams && Array.isArray(message.teams)) {
                        // Получаем ключ для хранения команд из CONFIG
                        const customTeamsKey = CONFIG?.STORAGE?.CUSTOM_TEAMS_KEY || 'customTeams';
                        const lastTeamsUpdateKey = CONFIG?.STORAGE?.LAST_TEAMS_UPDATE_KEY || 'lastTeamsUpdate';

                        // Сохраняем команды в хранилище
                        await chrome.storage.local.set({
                            [customTeamsKey]: message.teams,
                            [lastTeamsUpdateKey]: new Date().toISOString()
                        });

                        // Обновляем кэш
                        tempoData.teamsCache = message.teams;
                        tempoData.lastTeamsUpdate = new Date().toISOString();

                        response = {
                            success: true,
                            message: `Сохранено ${message.teams.length} команд`,
                            count: message.teams.length
                        };
                    } else {
                        response = {
                            success: false,
                            error: 'Неверный формат данных команд'
                        };
                    }
                } catch (error) {
                    console.error('[MessageHandler] Ошибка сохранения команд:', error);
                    response = {
                        success: false,
                        error: error.message
                    };
                }
                break;

            case 'UPDATE_AUTO_CHECK_SETTINGS':
                console.log('[MessageHandler] Обновление настроек автопроверки...', message.settings);
                try {
                    if (message.settings) {
                        // Получаем ключ для хранения настроек из CONFIG
                        const autoCheckSettingsKey = CONFIG?.STORAGE?.AUTO_CHECK_SETTINGS_KEY || 'autoCheckSettings';

                        // Сохраняем настройки
                        await chrome.storage.local.set({
                            [autoCheckSettingsKey]: message.settings
                        });

                        // Перенастраиваем ежедневную проверку
                        setupDailyCheck();

                        response = {
                            success: true,
                            message: 'Настройки автопроверки обновлены',
                            settings: message.settings
                        };
                    } else {
                        response = {
                            success: false,
                            error: 'Не указаны настройки'
                        };
                    }
                } catch (error) {
                    console.error('[MessageHandler] Ошибка обновления настроек автопроверки:', error);
                    response = {
                        success: false,
                        error: error.message
                    };
                }
                break;

            case 'GET_AUTO_CHECK_SETTINGS':
                console.log('[MessageHandler] Получение настроек автопроверки...');
                try {
                    // Получаем ключ для хранения настроек из CONFIG
                    const autoCheckSettingsKey = CONFIG?.STORAGE?.AUTO_CHECK_SETTINGS_KEY || 'autoCheckSettings';

                    const result = await chrome.storage.local.get(autoCheckSettingsKey);
                    const defaultSettings = getDefaultCheckSettings();
                    const settings = result[autoCheckSettingsKey] || defaultSettings;

                    response = {
                        success: true,
                        settings: settings
                    };
                } catch (error) {
                    console.error('[MessageHandler] Ошибка получения настроек автопроверки:', error);
                    response = {
                        success: false,
                        error: error.message,
                        settings: getDefaultCheckSettings()
                    };
                }
                break;

            case 'GET_CUSTOM_TEAMS':
                console.log('[MessageHandler] Получение пользовательских команд...');
                try {
                    // Получаем ключ для хранения команд из CONFIG
                    const customTeamsKey = CONFIG?.STORAGE?.CUSTOM_TEAMS_KEY || 'customTeams';

                    const result = await chrome.storage.local.get(customTeamsKey);
                    const teams = result[customTeamsKey] || null;

                    response = {
                        success: true,
                        teams: teams,
                        hasCustomTeams: !!teams
                    };
                } catch (error) {
                    console.error('[MessageHandler] Ошибка получения пользовательских команд:', error);
                    response = {
                        success: false,
                        error: error.message,
                        teams: null
                    };
                }
                break;

            case 'GET_CONFIG':
                console.log('[MessageHandler] Получение конфигурации...');
                response = {
                    success: true,
                    config: {
                        JIRA_URL: CONFIG?.JIRA?.URL,
                        DEFAULT_TEAM_ID: CONFIG?.CHECK?.DEFAULT_TEAM_ID || 91,
                        DEFAULT_CHECK_TIME: CONFIG?.CHECK?.DEFAULT_CHECK_TIME || '17:00',
                        NOTIFICATION_ICON: getNotificationIcon()
                    }
                };
                break;

            case 'TEST_SCRIPTING':
                console.log('[MessageHandler] Тестирование scripting API...');
                try {
                    // Пробуем получить текущую вкладку
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

                    if (tabs.length === 0) {
                        throw new Error('Нет активной вкладки');
                    }

                    // Пробуем выполнить простой скрипт
                    const results = await chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        func: () => document.title
                    });

                    response = {
                        success: true,
                        message: `Scripting API работает. Заголовок: ${results[0].result}`,
                        tabUrl: tabs[0].url
                    };
                } catch (error) {
                    response = {
                        success: false,
                        error: error.message,
                        message: 'Scripting API не доступен. Убедитесь, что в manifest.json есть разрешение "scripting"'
                    };
                }
                break;

            case 'PING':
                response = {
                    success: true,
                    message: 'pong',
                    timestamp: new Date().toISOString(),
                    version: '1.0.0'
                };
                break;

            default:
                console.warn('[MessageHandler] Неизвестный тип сообщения:', message.type);
                response = {
                    success: false,
                    error: 'Неизвестный тип сообщения: ' + message.type
                };
        }

        console.log('[MessageHandler] Отправка ответа:', response?.success ? 'Успех' : 'Ошибка');
        sendResponse(response);

    } catch (error) {
        console.error('[MessageHandler] Критическая ошибка обработки сообщения:', error);
        sendResponse({
            success: false,
            error: 'Критическая ошибка: ' + error.message,
            stack: error.stack
        });
    }
}

// Вспомогательная функция для показа уведомлений
async function showNotification(title, message, requireInteraction = false) {
    try {
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: getNotificationIcon(),
            title: title,
            message: message,
            priority: 2,
            requireInteraction: requireInteraction
        });
        console.log(`[MessageHandler] Уведомление показано: ${title}`);
    } catch (error) {
        console.error('[MessageHandler] Ошибка показа уведомления:', error);
    }
}

export { handleMessage };
