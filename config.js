// config.js - модульная версия для Chrome Extension

const JIRA_URL = 'https://jira.examle.com';
const TEMPO_BASE_PATH = '/secure/Tempo.jspa';
const API_BASE = '/rest/api/2';

const CONFIG = {
    JIRA: {
        URL: JIRA_URL,
        TEMPO_BASE_PATH: TEMPO_BASE_PATH,
        API_BASE: API_BASE
    },
    URL_TEMPLATES: {
        JIRA_HOME: () => JIRA_URL,
        TEMPO_HOME: () => `${JIRA_URL}${TEMPO_BASE_PATH}`,
        TEAM_APPROVALS: (teamId, date = '') => {
            const baseUrl = `${JIRA_URL}${TEMPO_BASE_PATH}#/teams/team/${teamId}/approvals`;
            return date ? `${baseUrl}?date=${date}` : baseUrl;
        },
        USER_API: () => `${JIRA_URL}${API_BASE}/myself`,
        TEAM_MEMBERS: (teamId) => `${JIRA_URL}${TEMPO_BASE_PATH}#/teams/team/${teamId}/members`
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
        MATCHES: ['https://jira.example.com/*']
    }
};

// Экспортируем как именованный экспорт
export { CONFIG };

// Для обратной совместимости с content scripts можно также экспортировать дефолтный
export default CONFIG;
