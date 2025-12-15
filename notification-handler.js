// notification-handler.js - Исправленная версия
// Обработчик уведомлений

import * as CONFIG from './config.js'; // Изменено: фигурные скобки

function setupNotificationHandlers() {
    chrome.notifications.onClicked.addListener(() => {
        chrome.tabs.create({
            url: CONFIG.JIRA.URL + CONFIG.JIRA.TEMPO_BASE_PATH
        });
    });
}

export { setupNotificationHandlers };
