// auth-manager.js
// Модуль управления авторизацией

import { tempoData } from './tempo-data.js';
import { CONFIG } from './config.js'; // Исправлен импорт

// Проверяем, загружен ли конфиг
if (!CONFIG) {
    console.error('[AuthManager] CONFIG не загружен! Проверьте загрузку config.js');
    throw new Error('CONFIG не инициализирован');
}

const JIRA_URL = CONFIG.JIRA.URL; // или CONFIG.default.JIRA.URL

// Проверка авторизации в Jira
async function checkAuthentication() {
    try {
        console.log('[AuthManager] Проверяем авторизацию...');

        // Проверяем наличие cookies для Jira
        const cookies = await chrome.cookies.getAll({
            url: JIRA_URL
        });

        // Ищем важные cookies авторизации
        const hasAuthCookies = cookies.some(cookie =>
            cookie.name.includes('session') ||
            cookie.name.includes('auth') ||
            cookie.name.includes('JSESSIONID') ||
            cookie.name.includes('atlassian.xsrf.token')
        );

        // Также проверяем наличие cookies с именем пользователя или токеном
        const hasUserCookies = cookies.some(cookie =>
            cookie.name.includes('user') ||
            cookie.name.includes('username') ||
            cookie.value.length > 50 // Длинные значения могут быть токенами
        );

        const isAuthenticated = hasAuthCookies || (cookies.length > 0 && hasUserCookies);

        tempoData.isAuthenticated = isAuthenticated;

        console.log(`[AuthManager] Авторизация: ${isAuthenticated ? 'ДА' : 'НЕТ'}`);
        console.log(`[AuthManager] Найдено cookies: ${cookies.length}`);

        if (cookies.length > 0 && !isAuthenticated) {
            console.log('[AuthManager] Найденные cookies:', cookies.map(c => ({
                name: c.name,
                domain: c.domain,
                secure: c.secure,
                session: c.session
            })));
        }

        return isAuthenticated;

    } catch (error) {
        console.error('[AuthManager] Ошибка проверки авторизации:', error);
        tempoData.isAuthenticated = false;
        return false;
    }
}

// Проверка доступа к странице команд
async function checkTeamsPageAccess() {
    try {
        console.log('[AuthManager] Проверяем доступ к странице команд...');

        // Проверяем наличие URL_TEMPLATES
        if (!CONFIG.URL_TEMPLATES?.TEMPO_HOME) {
            console.error('[AuthManager] URL_TEMPLATES.TEMPO_HOME не определен');
            return false;
        }
        const JIRA_URL = CONFIG.JIRA.URL;

        // Пробуем получить заголовок страницы через fetch
        const response = await fetch(CONFIG.URL_TEMPLATES.TEMPO_HOME(), {
            method: 'HEAD',
            credentials: 'include',
            redirect: 'follow'
        });

        const hasAccess = response.ok && response.status === 200;

        console.log(`[AuthManager] Доступ к странице команд: ${hasAccess ? 'ЕСТЬ' : 'НЕТ'}`);

        return hasAccess;

    } catch (error) {
        console.error('[AuthManager] Ошибка проверки доступа к странице:', error);
        return false;
    }
}

// Проверка доступности определенной команды
async function checkTeamAccess(teamId) {
    try {
        console.log(`[AuthManager] Проверяем доступ к команде ${teamId}...`);

        // Проверяем наличие URL_TEMPLATES
        if (!CONFIG.URL_TEMPLATES?.TEAM_APPROVALS) {
            console.error('[AuthManager] URL_TEMPLATES.TEAM_APPROVALS не определен');
            return false;
        }

        const response = await fetch(CONFIG.URL_TEMPLATES.TEAM_APPROVALS(teamId), {
            method: 'HEAD',
            credentials: 'include'
        });

        const hasAccess = response.ok;

        console.log(`[AuthManager] Доступ к команде ${teamId}: ${hasAccess ? 'ЕСТЬ' : 'НЕТ'}`);

        return hasAccess;

    } catch (error) {
        console.error(`[AuthManager] Ошибка проверки доступа к команде ${teamId}:`, error);
        return false;
    }
}

// Получение информации о текущем пользователе
async function getCurrentUser() {
    try {
        console.log('[AuthManager] Получаем информацию о пользователе...');

        // Проверяем наличие URL_TEMPLATES
        if (!CONFIG.URL_TEMPLATES?.USER_API) {
            console.error('[AuthManager] URL_TEMPLATES.USER_API не определен');
            return null;
        }

        const response = await fetch(CONFIG.URL_TEMPLATES.USER_API(), {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            const userData = await response.json();
            console.log('[AuthManager] Пользователь:', userData.displayName);
            return userData;
        } else {
            console.log('[AuthManager] Не удалось получить информацию о пользователе');
            return null;
        }

    } catch (error) {
        console.error('[AuthManager] Ошибка получения информации о пользователе:', error);
        return null;
    }
}

// Принудительная проверка авторизации с открытием вкладки
async function forceAuthentication() {
    try {
        console.log('[AuthManager] Принудительная проверка авторизации...');

        // Сначала проверяем текущую авторизацию
        let isAuthenticated = await checkAuthentication();

        if (!isAuthenticated) {
            console.log('[AuthManager] Авторизация отсутствует, открываем Jira...');

            // Проверяем наличие URL_TEMPLATES
            if (!CONFIG.URL_TEMPLATES?.JIRA_HOME) {
                console.error('[AuthManager] URL_TEMPLATES.JIRA_HOME не определен');
                return false;
            }

            // Открываем вкладку с Jira для авторизации
            chrome.tabs.create({
                url: CONFIG.URL_TEMPLATES.JIRA_HOME(),
                active: true
            });

            // Ждем 5 секунд для авторизации
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Проверяем снова
            isAuthenticated = await checkAuthentication();
        }

        console.log(`[AuthManager] Авторизация после принудительной проверки: ${isAuthenticated ? 'ДА' : 'НЕТ'}`);
        return isAuthenticated;

    } catch (error) {
        console.error('[AuthManager] Ошибка принудительной проверки авторизации:', error);
        return false;
    }
}

// Экспортируем функции
export {
    checkAuthentication,
    checkTeamsPageAccess,
    checkTeamAccess,
    getCurrentUser,
    forceAuthentication
};
