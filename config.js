// shared-config.js - ЕДИНЫЙ источник конфигурации для всего расширения

// Сначала определяем конфигурацию как константу
const CONFIG = {
    JIRA: {
        URL: 'https://jira.example.com', // ТОЛЬКО ЗДЕСЬ!
        TEMPO_BASE_PATH: '/secure/Tempo.jspa',
        API_BASE: '/rest/api/2'
    },
    URL_TEMPLATES: {
        JIRA_HOME: () => CONFIG.JIRA.URL,
        TEMPO_HOME: () => `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}`,
        TEAM_APPROVALS: (teamId, date = '') => {
            const baseUrl = `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}#/teams/team/${teamId}/approvals`;
            return date ? `${baseUrl}?date=${date}` : baseUrl;
        },
        USER_API: () => `${CONFIG.JIRA.URL}${CONFIG.JIRA.API_BASE}/myself`,
        TEAM_MEMBERS: (teamId) => `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}#/teams/team/${teamId}/members`
    },
    CHECK: {
        DEFAULT_TEAM_ID: 91,
        DEFAULT_CHECK_TIME: '17:00',
        DEFAULT_CHECK_INTERVAL: 'daily',
        DEFAULT_CHECK_DAYS: ['mon', 'tue', 'wed', 'thu', 'fri']
    },
    STORAGE: {
        SETTINGS_KEY: 'tempoSettings',
        DATA_KEY: 'tempoData',
        TEAMS_CACHE_KEY: 'teamsCache',
        LAST_TEAMS_UPDATE_KEY: 'lastTeamsUpdate',
        AUTO_CHECK_SETTINGS_KEY: 'autoCheckSettings',
        CUSTOM_TEAMS_KEY: 'customTeams'
    },
    NOTIFICATIONS: {
        ICON_URL: 'icons/icon48.png'
    },
    CONTENT_SCRIPTS: {
        MATCHES: [`https://jira.example.com/*`]
    }
};

// Экспортируем конфиг
export { CONFIG };

// Для обратной совместимости в браузерной среде
if (typeof window !== 'undefined') {
    // Используем setTimeout, чтобы убедиться, что CONFIG полностью инициализирован
    setTimeout(() => {
        window.TEMPO_CONFIG = CONFIG;
    }, 0);
}
