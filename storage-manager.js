// Модуль управления хранилищем

import { tempoData } from './tempo-data.js';

const STORAGE_KEYS = {
    SETTINGS: 'tempoSettings',
    DATA: 'tempoData',
    TEAMS_CACHE: 'teamsCache',
    LAST_TEAMS_UPDATE: 'lastTeamsUpdate'
};

// Инициализация хранилища
async function initializeStorage() {
    try {
        // Проверяем наличие настроек
        const settings = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);

        if (!settings[STORAGE_KEYS.SETTINGS]) {
            // Создаем начальные настройки
            await saveSettings();
        }

        console.log('[StorageManager] Хранилище инициализировано');
    } catch (error) {
        console.error('[StorageManager] Ошибка инициализации хранилища:', error);
        throw error;
    }
}

// Загрузка настроек
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
        const settings = result[STORAGE_KEYS.SETTINGS] || {};

        if (settings.teamId) {
            tempoData.selectedTeamId = settings.teamId;
        }
        if (settings.teamName) {
            tempoData.selectedTeamName = settings.teamName;
        }

        console.log('[StorageManager] Настройки загружены:', settings);
        return settings;
    } catch (error) {
        console.error('[StorageManager] Ошибка загрузки настроек:', error);
        return {};
    }
}

// Сохранение настроек
async function saveSettings() {
    try {
        const settings = {
            teamId: tempoData.selectedTeamId,
            teamName: tempoData.selectedTeamName
        };

        await chrome.storage.local.set({
            [STORAGE_KEYS.SETTINGS]: settings
        });

        console.log('[StorageManager] Настройки сохранены:', settings);
        return settings;
    } catch (error) {
        console.error('[StorageManager] Ошибка сохранения настроек:', error);
        throw error;
    }
}

// Загрузка данных
async function loadData() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.DATA);
        const data = result[STORAGE_KEYS.DATA] || {};

        // Загружаем кэш команд
        const cacheResult = await chrome.storage.local.get([STORAGE_KEYS.TEAMS_CACHE, STORAGE_KEYS.LAST_TEAMS_UPDATE]);

        tempoData.teamsCache = cacheResult[STORAGE_KEYS.TEAMS_CACHE] || null;
        tempoData.lastTeamsUpdate = cacheResult[STORAGE_KEYS.LAST_TEAMS_UPDATE] || null;

        // Обновляем tempoData из сохраненных данных
        if (data.notSubmittedUsers) {
            tempoData.notSubmittedUsers = data.notSubmittedUsers;
        }
        if (data.lastCheck) {
            tempoData.lastCheck = data.lastCheck;
        }

        console.log('[StorageManager] Данные загружены');
        return data;
    } catch (error) {
        console.error('[StorageManager] Ошибка загрузки данных:', error);
        return {};
    }
}

// Сохранение данных
async function saveData() {
    try {
        const data = {
            notSubmittedUsers: tempoData.notSubmittedUsers,
            lastCheck: tempoData.lastCheck,
            teamId: tempoData.selectedTeamId,
            teamName: tempoData.selectedTeamName
        };

        await chrome.storage.local.set({
            [STORAGE_KEYS.DATA]: data
        });

        console.log('[StorageManager] Данные сохранены');
        return data;
    } catch (error) {
        console.error('[StorageManager] Ошибка сохранения данных:', error);
        throw error;
    }
}

// Сохранение кэша команд
async function saveTeamsCache(teams) {
    try {
        tempoData.teamsCache = teams;
        tempoData.lastTeamsUpdate = new Date().toISOString();

        await chrome.storage.local.set({
            [STORAGE_KEYS.TEAMS_CACHE]: teams,
            [STORAGE_KEYS.LAST_TEAMS_UPDATE]: tempoData.lastTeamsUpdate
        });

        console.log('[StorageManager] Кэш команд сохранен:', teams.length, 'команд');
        return teams;
    } catch (error) {
        console.error('[StorageManager] Ошибка сохранения кэша команд:', error);
        throw error;
    }
}

// Очистка кэша команд
async function clearTeamsCache() {
    try {
        tempoData.teamsCache = null;
        tempoData.lastTeamsUpdate = null;

        await chrome.storage.local.remove([STORAGE_KEYS.TEAMS_CACHE, STORAGE_KEYS.LAST_TEAMS_UPDATE]);

        console.log('[StorageManager] Кэш команд очищен');
    } catch (error) {
        console.error('[StorageManager] Ошибка очистки кэша команд:', error);
        throw error;
    }
}

// Проверка актуальности кэша команд
function isTeamsCacheValid(minutes = 60) {
    if (!tempoData.teamsCache || !tempoData.lastTeamsUpdate) {
        return false;
    }

    const cacheAge = Date.now() - new Date(tempoData.lastTeamsUpdate).getTime();
    const maxAge = minutes * 60 * 1000; // минуты в миллисекундах

    return cacheAge < maxAge;
}

// Получение кэшированных команд
function getCachedTeams() {
    return tempoData.teamsCache;
}

// Экспорт функций
export {
    initializeStorage,
    loadSettings,
    saveSettings,
    loadData,
    saveData,
    saveTeamsCache,
    clearTeamsCache,
    isTeamsCacheValid,
    getCachedTeams,
    STORAGE_KEYS
};
