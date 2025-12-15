// Модуль проверки статусов Tempo - упрощенная версия

import { tempoData } from './tempo-data.js';
import { saveData } from './storage-manager.js';
import { waitForTabLoad, closeTabSafely } from './tab-manager.js';
import { checkAuthentication } from './auth-manager.js';
import { CONFIG } from './config.js'; // Импортируем конфигурацию

// Проверка статусов Tempo
async function checkTempoStatus(date = null) {
    console.log(`[TempoChecker] Начинаем проверку статусов для команды ${tempoData.selectedTeamId}${date ? ` на неделю ${date}` : ''}...`);

    try {
        // Проверяем авторизацию еще раз перед началом
        if (!tempoData.isAuthenticated) {
            console.log('[TempoChecker] Проверяем авторизацию перед проверкой...');
            const isAuthenticated = await checkAuthentication();
            tempoData.isAuthenticated = isAuthenticated;

            if (!isAuthenticated) {
                console.log('[TempoChecker] Пользователь не авторизован, пропускаем проверку');
                // Уведомление показывается в message-handler.js
                return {
                    success: false,
                    error: 'Требуется авторизация в Jira. Откройте Jira и войдите в систему.',
                    users: [],
                    count: 0,
                    allUsers: [],
                    requiresAuth: true
                };
            }
        }

        // Используем метод с вкладкой
        const allUsers = await parseTempoPageWithTab(date);

        // Фильтруем пользователей, требующих внимания
        const problemUsers = allUsers.filter(user => {
            const status = user.status.toUpperCase();

            // Статусы, которые нужно подсвечивать
            return status.includes('ОТКРЫТ') ||
                   status.includes('OPEN') ||
                   status.includes('НЕ ОТПРАВЛЕН') ||
                   status.includes('NOT SUBMITTED') ||
                   status.includes('ГОТОВО К ОТПРАВКЕ') ||
                   status.includes('ОЖИДАЕТ УТВЕРЖДЕНИЯ') ||
                   status.includes('READY TO SEND') ||
                   status.includes('AWAITING APPROVAL');
        });

        // Отдельно считаем не отправленных (старый фильтр для обратной совместимости)
        const notSubmittedUsers = allUsers.filter(user => {
            const status = user.status.toUpperCase();
            return status.includes('ОТКРЫТ') ||
                   status.includes('OPEN') ||
                   status.includes('НЕ ОТПРАВЛЕН') ||
                   status.includes('NOT SUBMITTED');
        });

        // Обновляем данные
        tempoData.notSubmittedUsers = problemUsers; // Теперь храним всех проблемных пользователей
        tempoData.lastCheck = new Date().toISOString();

        // Сохраняем данные
        await saveData();

        // Обновляем бейдж
        updateBadge();

        console.log(`[TempoChecker] Проверка завершена. Всего пользователей: ${allUsers.length}, Проблемные: ${problemUsers.length}, Не отправили: ${notSubmittedUsers.length}`);

        // Всегда показываем результат в консоли
        if (allUsers.length > 0) {
            console.log('[TempoChecker] Найденные пользователи:');
            allUsers.forEach((user, index) => {
                const isProblem = problemUsers.some(pu => pu.name === user.name);
                const prefix = isProblem ? '⚠️ ' : '   ';
                console.log(`  ${prefix}${index + 1}. ${user.name} - ${user.status}`);
            });
        }

        // Если есть проблемные пользователи, показываем уведомление
        if (problemUsers.length > 0) {
            await showNotificationDirectly(problemUsers.length, notSubmittedUsers.length);
        }

        return {
            success: true,
            users: problemUsers,
            allUsers: allUsers,
            count: problemUsers.length,
            notSubmittedCount: notSubmittedUsers.length,
            totalCount: allUsers.length,
            lastCheck: tempoData.lastCheck
        };

    } catch (error) {
        console.error('[TempoChecker] Ошибка проверки статусов:', error);

        // Определяем тип ошибки
        const errorMessage = error.message || error.toString();
        let errorType = 'unknown';

        if (errorMessage.includes('DNS_PROBE_FINISHED_NXDOMAIN') ||
            errorMessage.includes('ERR_NAME_NOT_RESOLVED') ||
            errorMessage.includes('this site can\'t be reached')) {
            errorType = 'dns';
        } else if (errorMessage.includes('авторизация') ||
                   errorMessage.includes('authorization') ||
                   errorMessage.includes('authentication')) {
            errorType = 'auth';
        }

        // Уведомление показывается в message-handler.js
        return {
            success: false,
            error: errorMessage,
            errorType: errorType,
            users: [],
            allUsers: [],
            count: 0,
            totalCount: 0
        };
    }
}

// Прямой показ уведомления о проблемных пользователях
async function showNotificationDirectly(problemCount, notSubmittedCount = null) {
    if (problemCount === 0) return;

    let title, message;

    if (notSubmittedCount !== null && notSubmittedCount > 0) {
        // Смешанные статусы: есть и не отправленные, и ожидающие утверждения
        const otherCount = problemCount - notSubmittedCount;

        if (otherCount > 0) {
            title = `Tempo Checker: ${problemCount} требуют внимания`;
            message = `${notSubmittedCount} не отправили Tempo, ${otherCount} ожидают утверждения`;
        } else {
            // Только не отправленные
            title = `Tempo Checker: ${notSubmittedCount} не отправили`;
            message = notSubmittedCount === 1 ?
                '1 человек не отправил Tempo' :
                `${notSubmittedCount} человек не отправили Tempo`;
        }
    } else {
        // Простой подсчет
        title = `Tempo Checker: ${problemCount} требуют внимания`;
        message = problemCount === 1 ?
            '1 человек требует внимания (не отправил или ожидает утверждения)' :
            `${problemCount} человек требуют внимания (не отправили или ожидают утверждения)`;
    }

    try {
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: CONFIG.NOTIFICATIONS.ICON_URL,
            title: title,
            message: message,
            priority: 2,
            requireInteraction: false
        });
        console.log(`[TempoChecker] Уведомление показано: ${message}`);
    } catch (error) {
        console.error('[TempoChecker] Ошибка показа уведомления:', error);
    }
}

// Парсинг через открытие вкладки
async function parseTempoPageWithTab(date = null) {
    // Используем конфигурацию для построения URL
    const url = CONFIG.URL_TEMPLATES.TEAM_APPROVALS(tempoData.selectedTeamId, date);

    console.log(`[TempoChecker] Открываем страницу для парсинга: ${url}`);

    let tab = null;

    try {
        // Создаем вкладку
        tab = await chrome.tabs.create({
            url: url,
            active: false
        });

        console.log(`[TempoChecker] Вкладка создана: ${tab.id}`);

        // Используем waitForTabLoad из tab-manager.js
        await waitForTabLoad(tab.id);

        // Сразу проверяем, не показывает ли вкладка страницу ошибки DNS
        const hasDnsError = await checkForDnsError(tab.id);
        if (hasDnsError) {
            throw new Error('DNS_PROBE_FINISHED_NXDOMAIN - сайт недоступен');
        }

        // Даем время на загрузку AJAX контента
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Пробуем парсинг через content script
        let allUsers = [];

        try {
            const usersFromContentScript = await parsePageViaContentScript(tab.id);
            console.log(`[TempoChecker] Content script нашел: ${usersFromContentScript.length} пользователей`);
            allUsers = allUsers.concat(usersFromContentScript);
        } catch (error) {
            console.error('[TempoChecker] Ошибка content script:', error);
        }

        // Если content script не нашел, пробуем простой парсинг
        if (allUsers.length < 2) {
            try {
                const usersFromSimpleParse = await parsePageViaSimpleScript(tab.id);
                console.log(`[TempoChecker] Simple script нашел: ${usersFromSimpleParse.length} пользователей`);
                allUsers = allUsers.concat(usersFromSimpleParse);
            } catch (error) {
                console.error('[TempoChecker] Ошибка simple script:', error);
            }
        }

        // Проверяем, не произошла ли DNS ошибка во время парсинга
        // (иногда страница загружается нормально, но потом переходит на ошибку)
        const hasDnsErrorAfterParse = await checkForDnsError(tab.id, true);
        if (hasDnsErrorAfterParse) {
            throw new Error('DNS_PROBE_FINISHED_NXDOMAIN - сайт недоступен');
        }

        // Удаляем дубликаты
        const uniqueUsers = [];
        const seenNames = new Set();

        allUsers.forEach(user => {
            const normalizedName = user.name.toLowerCase().replace(/\s+/g, ' ').trim();
            if (!seenNames.has(normalizedName)) {
                seenNames.add(normalizedName);
                uniqueUsers.push(user);
            }
        });

        console.log(`[TempoChecker] Всего уникальных пользователей: ${uniqueUsers.length}`);

        return uniqueUsers;

    } catch (error) {
        console.error('[TempoChecker] Ошибка парсинга:', error);
        throw error;

    } finally {
        // Всегда закрываем вкладку, если она была создана
        if (tab && tab.id) {
            try {
                // Используем closeTabSafely из tab-manager.js
                await closeTabSafely(tab.id);
            } catch (closeError) {
                console.error('[TempoChecker] Ошибка закрытия вкладки:', closeError);
            }
        }
    }
}

// Парсинг через content script с подсветкой
async function parsePageViaContentScript(tabId) {
    return new Promise((resolve) => {
        // Ждем 3 секунды для загрузки контента перед отправкой сообщения
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
                action: 'parseTempoPage',
                teamId: tempoData.selectedTeamId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('[TempoChecker] Content script не ответил:', chrome.runtime.lastError.message);

                    // Пробуем добавить подсветку через executeScript
                    setTimeout(() => {
                        highlightProblemRows(tabId);
                    }, 1000);

                    resolve([]);
                } else {
                    // Добавляем подсветку строк после парсинга
                    setTimeout(() => {
                        highlightProblemRows(tabId);
                    }, 1000);

                    resolve(response?.users || []);
                }
            });
        }, 3000);
    });
}

// Подсветка проблемных строк через executeScript
function highlightProblemRows(tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: highlightTempoRows
    }, (results) => {
        if (chrome.runtime.lastError) {
            console.log('[TempoChecker] Не удалось подсветить строки:', chrome.runtime.lastError.message);
        } else {
            console.log('[TempoChecker] Строки подсвечены');
        }
    });
}

// Функция подсветки проблемных строк в Tempo
function highlightTempoRows() {
    console.log('[TempoChecker-Highlight] Начинаем подсветку проблемных строк...');

    try {
        // Ищем все ячейки статуса
        const statusCells = document.querySelectorAll('td[data-column-key="status"], td:nth-child(3)');
        let highlightedCount = 0;

        statusCells.forEach(cell => {
            const status = cell.textContent.trim().toUpperCase();

            // Проверяем, является ли статус проблемным
            const isProblemStatus =
                status.includes('ОТКРЫТ') ||
                status.includes('OPEN') ||
                status.includes('НЕ ОТПРАВЛЕН') ||
                status.includes('NOT SUBMITTED') ||
                status.includes('ГОТОВО К ОТПРАВКЕ') ||
                status.includes('ОЖИДАЕТ УТВЕРЖДЕНИЯ') ||
                status.includes('READY TO SEND') ||
                status.includes('AWAITING APPROVAL');

            if (isProblemStatus) {
                // Находим родительскую строку
                const row = cell.closest('tr');
                if (row && !row.classList.contains('tempo-problem-row')) {
                    row.classList.add('tempo-problem-row');
                    highlightedCount++;

                    // Добавляем стили
                    row.style.backgroundColor = '#ffebee';
                    row.style.borderLeft = '4px solid #f44336';

                    // Добавляем иконку в первую ячейку
                    const firstCell = row.querySelector('td:first-child');
                    if (firstCell && !firstCell.querySelector('.tempo-warning-icon')) {
                        const icon = document.createElement('span');
                        icon.className = 'tempo-warning-icon';
                        icon.textContent = '⚠️';
                        icon.style.marginRight = '8px';
                        icon.style.color = '#f44336';
                        icon.style.fontSize = '14px';
                        firstCell.insertBefore(icon, firstCell.firstChild);
                    }
                }
            }
        });

        console.log(`[TempoChecker-Highlight] Подсвечено строк: ${highlightedCount}`);

        // Добавляем стили CSS, если их еще нет
        if (!document.querySelector('#tempo-highlight-styles')) {
            const style = document.createElement('style');
            style.id = 'tempo-highlight-styles';
            style.textContent = `
                .tempo-problem-row {
                    background-color: #ffebee !important;
                    border-left: 4px solid #f44336 !important;
                }
                .tempo-problem-row:hover {
                    background-color: #ffcdd2 !important;
                }
                .tempo-warning-icon {
                    animation: blink 1.5s infinite;
                }
                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `;
            document.head.appendChild(style);
        }

    } catch (error) {
        console.error('[TempoChecker-Highlight] Ошибка подсветки:', error);
    }
}

// Проверка на ошибку DNS без использования скриптов
async function checkForDnsError(tabId, retry = false) {
    return new Promise((resolve) => {
        // Даем время на загрузку страницы
        const delay = retry ? 2000 : 0;

        setTimeout(() => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    console.log('[TempoChecker] Не удалось получить информацию о вкладке для проверки DNS:', chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }

                if (!tab || !tab.url) {
                    resolve(false);
                    return;
                }

                const url = tab.url.toLowerCase();
                console.log(`[TempoChecker] Проверяем URL вкладки: ${url}`);

                // Проверяем явные ошибки Chrome DNS
                const dnsErrorPatterns = [
                    'chrome-error://chromewebdata/',
                    'chrome-error://',
                    'dns_probe_finished_nxdomain',
                    'err_name_not_resolved'
                ];

                for (const pattern of dnsErrorPatterns) {
                    if (url.includes(pattern)) {
                        console.log(`[TempoChecker] Обнаружена DNS ошибка в URL: ${pattern}`);
                        resolve(true);
                        return;
                    }
                }

                // Проверяем заголовок страницы (если есть)
                if (tab.title) {
                    const title = tab.title.toLowerCase();
                    console.log(`[TempoChecker] Заголовок страницы: ${title}`);

                    const dnsErrorTitles = [
                        'dns_probe_finished_nxdomain',
                        'this site can\'t be reached',
                        'err_name_not_resolved',
                        'сайт не доступен',
                        'не удается получить доступ к сайту',
                        'this site cannot be reached',
                        `check if there is a typo in ${CONFIG.JIRA.URL.replace('https://', '')}`
                    ];

                    for (const errorTitle of dnsErrorTitles) {
                        if (title.includes(errorTitle)) {
                            console.log(`[TempoChecker] Обнаружена DNS ошибка в заголовке: ${errorTitle}`);
                            resolve(true);
                            return;
                        }
                    }
                }

                // Если не нашли DNS ошибок
                resolve(false);
            });
        }, delay);
    });
}

// Простой парсинг через executeScript с полной защитой от ошибок
async function parsePageViaSimpleScript(tabId) {
    return new Promise((resolve) => {
        // Сначала проверяем, можно ли вообще выполнить скрипт на этой странице
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.log('[TempoChecker] Не удалось получить информацию о вкладке:', chrome.runtime.lastError.message);
                resolve([]);
                return;
            }

            if (!tab || !tab.url) {
                resolve([]);
                return;
            }

            const url = tab.url.toLowerCase();

            // Если это страница ошибок Chrome, не пытаемся выполнять скрипты
            if (url.startsWith('chrome-error://') ||
                url.includes('dns_probe_finished_nxdomain') ||
                url.includes('err_name_not_resolved') ||
                url.startsWith('data:text/html,chromewebdata')) {
                console.log('[TempoChecker] Это страница ошибок, пропускаем executeScript');
                resolve([]);
                return;
            }

            // Если страница выглядит нормально, пробуем выполнить скрипт
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: simpleTableParse
            }, (results) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;

                    // Обрабатываем разные типы ошибок
                    if (errorMsg.includes('Frame with ID') && errorMsg.includes('is showing error page')) {
                        console.log('[TempoChecker] Вкладка показывает страницу ошибки, пропускаем парсинг');
                    } else if (errorMsg.includes('Cannot access contents of url')) {
                        console.log('[TempoChecker] Нет доступа к содержимому страницы');
                    } else if (errorMsg.includes('The tab was closed')) {
                        console.log('[TempoChecker] Вкладка была закрыта');
                    } else {
                        console.error('[TempoChecker] Ошибка executeScript:', errorMsg);
                    }

                    resolve([]);
                    return;
                }

                if (results && results[0] && results[0].result) {
                    resolve(results[0].result);
                } else {
                    console.log('[TempoChecker] executeScript не вернул результатов');
                    resolve([]);
                }
            });
        });
    });
}

// Простая функция парсинга таблицы
function simpleTableParse() {
    console.log('[TempoChecker-Table] Парсинг таблицы...');

    const allUsers = [];

    try {
        // Проверяем, не страница ли это DNS ошибки
        const pageTitle = document.title || '';
        const pageText = document.body.textContent || '';

        // Проверяем только явные ошибки DNS
        const dnsErrors = [
            'DNS_PROBE_FINISHED_NXDOMAIN',
            'ERR_NAME_NOT_RESOLVED',
            'This site can\'t be reached',
            'Сайт не доступен',
            'не удается получить доступ к сайту',
            `check if there is a typo in ${CONFIG.JIRA.URL.replace('https://', '')}`
        ];

        for (const error of dnsErrors) {
            if (pageTitle.includes(error) || pageText.includes(error)) {
                console.log('[TempoChecker-Table] Страница показывает DNS ошибку:', error);
                return allUsers;
            }
        }

        // Простой и надежный метод: ищем все строки таблицы
        const rows = document.querySelectorAll('table tr, tbody tr');

        console.log(`[TempoChecker-Table] Найдено строк: ${rows.length}`);

        rows.forEach((row, index) => {
            try {
                // Получаем все ячейки в строке
                const cells = row.querySelectorAll('td');

                // Нужно минимум 3 ячейки: чекбокс, имя, статус
                if (cells.length >= 3) {
                    // Ячейка 1: имя (вторая ячейка)
                    const nameCell = cells[1];
                    // Ячейка 2: статус (третья ячейка)
                    const statusCell = cells[2];

                    if (nameCell && statusCell) {
                        // Извлекаем имя
                        let userName = nameCell.textContent || '';
                        userName = userName.trim().replace(/\s+/g, ' ');

                        // Извлекаем статус
                        let userStatus = statusCell.textContent || '';
                        userStatus = userStatus.trim();

                        // Если статус пустой, ищем span
                        if (!userStatus) {
                            const statusSpan = statusCell.querySelector('span');
                            if (statusSpan) {
                                userStatus = statusSpan.textContent || '';
                                userStatus = userStatus.trim();
                            }
                        }

                        // Проверяем что имя содержит пробел (фамилия и имя)
                        if (userName && userStatus && userName.includes(' ') && userName.length > 3) {
                            allUsers.push({
                                name: userName,
                                status: userStatus,
                                row: index
                            });

                            console.log(`[TempoChecker-Table] Строка ${index}: ${userName} - ${userStatus}`);
                        }
                    }
                }
            } catch (error) {
                // Игнорируем ошибки в отдельных строках
            }
        });

        // Если не нашли, пробуем другой подход
        if (allUsers.length === 0) {
            console.log('[TempoChecker-Table] Альтернативный поиск...');

            // Ищем все div с именами
            const allDivs = document.querySelectorAll('div');
            allDivs.forEach(div => {
                const text = div.textContent.trim();
                // Проверяем, похоже ли на имя (содержит пробел, не слишком длинное)
                if (text && text.includes(' ') && text.length > 3 && text.length < 50) {
                    // Ищем статус в родительской строке
                    const row = div.closest('tr');
                    if (row) {
                        const statusCell = row.querySelector('td:nth-child(3)');
                        if (statusCell) {
                            const status = statusCell.textContent.trim();
                            if (status) {
                                allUsers.push({
                                    name: text,
                                    status: status
                                });
                            }
                        }
                    }
                }
            });
        }

        console.log(`[TempoChecker-Table] Найдено пользователей: ${allUsers.length}`);
        return allUsers;

    } catch (error) {
        console.error('[TempoChecker-Table] Ошибка:', error);
        return [];
    }
}

// Обновление бейджа расширения
function updateBadge() {
    const count = tempoData.notSubmittedUsers.length;

    if (count > 0) {
        chrome.action.setBadgeText({ text: count.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }

    console.log(`[TempoChecker] Бейдж обновлен: ${count}`);
}

// Настройка автоматической проверки с учетом настроек
function setupDailyCheck() {
    console.log('[TempoChecker] Настраиваем автоматическую проверку...');

    // Очищаем существующие алермы
    chrome.alarms.clearAll();

    // Загружаем настройки автопроверки
    chrome.storage.local.get('autoCheckSettings', async (result) => {
        const settings = result.autoCheckSettings || {
            checkTime: CONFIG.CHECK.DEFAULT_CHECK_TIME,
            checkInterval: CONFIG.CHECK.DEFAULT_CHECK_INTERVAL,
            checkDays: CONFIG.CHECK.DEFAULT_CHECK_DAYS
        };

        console.log('[TempoChecker] Настройки автопроверки:', settings);

        const [hours, minutes] = settings.checkTime.split(':').map(Number);

        if (settings.checkInterval === 'daily') {
            // Ежедневная проверка в указанное время
            setupDailyAlarm(hours, minutes);
        } else if (settings.checkInterval === 'weekly') {
            // Еженедельная проверка в указанные дни
            setupWeeklyAlarm(hours, minutes, settings.checkDays);
        } else if (settings.checkInterval === 'monthly') {
            // Ежемесячная проверка
            setupMonthlyAlarm(hours, minutes);
        }
    });
}

// Настройка ежедневного алерма
function setupDailyAlarm(hours, minutes) {
    const now = new Date();
    const nextCheck = new Date();

    nextCheck.setHours(hours, minutes, 0, 0);

    if (now >= nextCheck) {
        nextCheck.setDate(nextCheck.getDate() + 1);
    }

    chrome.alarms.create('autoTempoCheck', {
        when: nextCheck.getTime(),
        periodInMinutes: 24 * 60 // 24 часа
    });

    console.log(`[TempoChecker] Ежедневная проверка настроена на ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
}

// Настройка еженедельного алерма
function setupWeeklyAlarm(hours, minutes, days) {
    const dayMap = {
        'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4,
        'fri': 5, 'sat': 6, 'sun': 0
    };

    const now = new Date();
    const today = now.getDay();

    // Находим ближайший день для проверки
    let daysToAdd = 7;
    days.forEach(day => {
        const targetDay = dayMap[day];
        let diff = targetDay - today;
        if (diff <= 0) diff += 7;

        if (diff < daysToAdd) {
            daysToAdd = diff;
        }
    });

    const nextCheck = new Date();
    nextCheck.setDate(now.getDate() + daysToAdd);
    nextCheck.setHours(hours, minutes, 0, 0);

    // Если время уже прошло сегодня и это сегодняшний день, переходим на следующую неделю
    if (daysToAdd === 0) {
        const todayCheck = new Date();
        todayCheck.setHours(hours, minutes, 0, 0);
        if (now >= todayCheck) {
            daysToAdd = 7;
            nextCheck.setDate(now.getDate() + daysToAdd);
        }
    }

    chrome.alarms.create('autoTempoCheck', {
        when: nextCheck.getTime(),
        periodInMinutes: 7 * 24 * 60 // 7 дней
    });

    console.log(`[TempoChecker] Еженедельная проверка настроена на дни: ${days.join(', ')} в ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
}

// Настройка ежемесячного алерма
function setupMonthlyAlarm(hours, minutes) {
    const now = new Date();
    const nextCheck = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    nextCheck.setHours(hours, minutes, 0, 0);

    chrome.alarms.create('autoTempoCheck', {
        when: nextCheck.getTime(),
        periodInMinutes: 30 * 24 * 60 // Примерно 30 дней
    });

    console.log(`[TempoChecker] Ежемесячная проверка настроена на ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
}

// Получение времени следующей проверки
function getNextCheckTime() {
    return new Promise((resolve) => {
        chrome.storage.local.get('autoCheckSettings', (result) => {
            const settings = result.autoCheckSettings || {
                checkTime: CONFIG.CHECK.DEFAULT_CHECK_TIME,
                checkInterval: CONFIG.CHECK.DEFAULT_CHECK_INTERVAL,
                checkDays: CONFIG.CHECK.DEFAULT_CHECK_DAYS
            };

            const [hours, minutes] = settings.checkTime.split(':').map(Number);
            const now = new Date();
            let nextCheck = new Date();

            if (settings.checkInterval === 'daily') {
                nextCheck.setHours(hours, minutes, 0, 0);
                if (now >= nextCheck) {
                    nextCheck.setDate(nextCheck.getDate() + 1);
                }
            } else if (settings.checkInterval === 'weekly') {
                const dayMap = {
                    'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4,
                    'fri': 5, 'sat': 6, 'sun': 0
                };
                const today = now.getDay();
                let daysToAdd = 7;

                settings.checkDays.forEach(day => {
                    const targetDay = dayMap[day];
                    let diff = targetDay - today;
                    if (diff <= 0) diff += 7;

                    if (diff < daysToAdd) {
                        daysToAdd = diff;
                    }
                });

                nextCheck.setDate(now.getDate() + daysToAdd);
                nextCheck.setHours(hours, minutes, 0, 0);
            } else if (settings.checkInterval === 'monthly') {
                nextCheck = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                nextCheck.setHours(hours, minutes, 0, 0);
            }

            resolve(nextCheck.getTime());
        });
    });
}

// Получение информации о следующей проверке для отображения
async function getNextCheckInfo() {
    try {
        const nextCheckTime = await getNextCheckTime();
        const nextCheckDate = new Date(nextCheckTime);

        return {
            time: nextCheckDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            date: nextCheckDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
            fullDate: nextCheckDate
        };
    } catch (error) {
        console.error('[TempoChecker] Ошибка получения информации о следующей проверке:', error);
        return {
            time: CONFIG.CHECK.DEFAULT_CHECK_TIME,
            date: 'завтра',
            fullDate: new Date()
        };
    }
}

// Экспорт функций
export {
    checkTempoStatus,
    updateBadge,
    showNotificationDirectly,
    setupDailyCheck,
    getNextCheckTime,
    getNextCheckInfo
};
