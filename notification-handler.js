// notification-handler.js - Исправленная версия
// Обработчик уведомлений

import { CONFIG } from './config.js';

function setupNotificationHandlers() {
    chrome.notifications.onClicked.addListener(() => {
        chrome.tabs.create({
            url: CONFIG.JIRA.URL + CONFIG.JIRA.TEMPO_BASE_PATH
        });
    });
}

export { setupNotificationHandlers };
