// Модуль управления вкладками

import { CONFIG } from './config.js'; // Импортируем из модуля

// Проверяем, загружен ли конфиг
if (!CONFIG) {
    console.error('[TabManager] CONFIG не загружен! Проверьте загрузку config.js');
    throw new Error('CONFIG не инициализирован');
}

let parsingTabId = null;

// Настройка менеджера вкладок
function setupTabManager() {
    console.log('[TabManager] Настраиваем менеджера вкладок...');

    // Слушаем закрытие вкладок
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        if (tabId === parsingTabId) {
            console.log(`[TabManager] Вкладка парсинга закрыта: ${tabId}`);
            parsingTabId = null;
        }
    });

    console.log('[TabManager] Менеджер вкладок настроен');
}

// Получение ID вкладки парсинга
function getParsingTabId() {
    return parsingTabId;
}

// Установка ID вкладки парсинга
function setParsingTabId(tabId) {
    parsingTabId = tabId;
    console.log(`[TabManager] Установлена вкладка парсинга: ${tabId}`);
}

// Закрытие вкладки парсинга
async function closeParsingTab() {
    if (!parsingTabId) {
        console.log('[TabManager] Нет активной вкладки парсинга для закрытия');
        return;
    }

    try {
        console.log(`[TabManager] Закрываем вкладку парсинга: ${parsingTabId}`);
        await closeTabSafely(parsingTabId);
        parsingTabId = null;
        console.log('[TabManager] Вкладка парсинга закрыта');
    } catch (error) {
        console.error('[TabManager] Ошибка закрытия вкладки:', error);
        parsingTabId = null;
    }
}

// Проверка, показывает ли вкладка страницу ошибки
async function checkIfTabHasError(tabId) {
    return new Promise((resolve) => {
        // Пробуем получить информацию о вкладке
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.log('[TabManager] Не удалось получить информацию о вкладке:', chrome.runtime.lastError.message);
                resolve(true); // Если не можем получить информацию, считаем что есть ошибка
                return;
            }

            if (!tab || !tab.url) {
                resolve(true);
                return;
            }

            // Проверяем, не является ли URL страницей ошибок
            const url = tab.url.toLowerCase();
            const errorUrls = [
                'chrome-error://',
                'about:blank#blocked',
                'about:blank',
                'data:text/html,chromewebdata'
            ];

            for (const errorUrl of errorUrls) {
                if (url.startsWith(errorUrl)) {
                    console.log('[TabManager] Вкладка показывает страницу ошибки:', url);
                    resolve(true);
                    return;
                }
            }

            // Если URL нормальный, пробуем проверить можно ли выполнить скрипт
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => true
            }, (results) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;
                    if (errorMsg.includes('Frame with ID') && errorMsg.includes('is showing error page')) {
                        console.log('[TabManager] Вкладка показывает страницу ошибки (frame error)');
                        resolve(true);
                    } else {
                        // Другие ошибки могут быть не критичными
                        resolve(false);
                    }
                } else {
                    // Если скрипт выполнился успешно, значит нет ошибки
                    resolve(false);
                }
            });
        });
    });
}

// Безопасное закрытие вкладки
async function closeTabSafely(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                console.log(`[TabManager] Вкладка ${tabId} уже закрыта: ${chrome.runtime.lastError.message}`);
            } else {
                console.log(`[TabManager] Вкладка ${tabId} закрыта`);
            }
            resolve();
        });
    });
}

// Проверка существования вкладки парсинга
async function checkParsingTabExists() {
    if (!parsingTabId) return false;

    try {
        const tab = await chrome.tabs.get(parsingTabId);
        return !!tab;
    } catch (error) {
        console.log(`[TabManager] Вкладка ${parsingTabId} не существует:`, error.message);
        parsingTabId = null;
        return false;
    }
}

// Создание новой вкладки парсинга
async function createParsingTab(url, active = false) {
    try {
        // Закрываем старую вкладку если есть
        if (parsingTabId) {
            await closeTabSafely(parsingTabId);
        }

        console.log(`[TabManager] Создаем вкладку парсинга: ${url}`);
        const tab = await chrome.tabs.create({
            url: url,
            active: active
        });

        parsingTabId = tab.id;
        console.log(`[TabManager] Вкладка создана: ${tab.id}`);

        return tab;
    } catch (error) {
        console.error('[TabManager] Ошибка создания вкладки:', error);
        throw error;
    }
}

// Ожидание завершения загрузки вкладки
async function waitForTabLoad(tabId, timeout = 30000) {
    return new Promise((resolve, reject) => {
        console.log(`[TabManager] Ожидаем загрузку вкладки ${tabId}...`);

        const timeoutId = setTimeout(() => {
            reject(new Error(`Таймаут загрузки вкладки ${tabId}`));
        }, timeout);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                console.log(`[TabManager] Вкладка ${tabId} загружена`);
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(listener);

        // Проверяем текущий статус
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error(`Вкладка ${tabId} не существует: ${chrome.runtime.lastError.message}`));
                return;
            }

            if (tab.status === 'complete') {
                console.log(`[TabManager] Вкладка ${tabId} уже загружена`);
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });
}

// Получение URL текущей активной вкладки
async function getCurrentTabUrl() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tabs.length > 0 && tabs[0].url) {
            return tabs[0].url;
        }

        return null;
    } catch (error) {
        console.error('[TabManager] Ошибка получения текущей вкладки:', error);
        return null;
    }
}

// Проверка, является ли вкладка Jira Tempo
function isTempoTab(url) {
    if (!url || !CONFIG?.JIRA?.URL || !CONFIG?.JIRA?.TEMPO_BASE_PATH) return false;

    const jiraUrl = CONFIG.JIRA.URL.toLowerCase();
    const tempoPath = CONFIG.JIRA.TEMPO_BASE_PATH.toLowerCase();
    const urlLower = url.toLowerCase();

    return urlLower.includes(jiraUrl) &&
           (urlLower.includes(tempoPath) || urlLower.includes('#/teams'));
}

// Экспорт функций
export {
    setupTabManager,
    getParsingTabId,
    setParsingTabId,
    closeParsingTab,
    checkParsingTabExists,
    createParsingTab,
    waitForTabLoad,
    getCurrentTabUrl,
    isTempoTab,
    closeTabSafely,
    checkIfTabHasError
};
