// Service Worker для Tempo Checker - основной файл

console.log('[TempoChecker] Background script загружен');

// Импорт модулей
import { tempoData } from './tempo-data.js';
import { initialize } from './background-init.js';
import { handleMessage } from './message-handler.js';
import { setupNotificationHandlers } from './notification-handler.js';

// Инициализация расширения
chrome.runtime.onInstalled.addListener(() => {
    console.log('[TempoChecker] Расширение установлено');
    initialize();
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[TempoChecker] Браузер запущен');
    initialize();
});

// Обработчик сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[TempoChecker] Получено сообщение:', message.type);
    handleMessage(message, sender, sendResponse);
    return true;
});

// Настройка обработчиков уведомлений
setupNotificationHandlers();

// Экспортируем основные функции для тестирования
export { initialize };
