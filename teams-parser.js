
// Модуль парсинга списка команд - УЛУЧШЕННАЯ ВЕРСИЯ

import { tempoData } from './tempo-data.js';
import { saveTeamsCache, isTeamsCacheValid, getCachedTeams } from './storage-manager.js';
import CONFIG from './config.js';

// Получение списка команд - быстрая версия
async function getTeamsList() {
    console.log('[TeamsParser] Получаем список команд (быстрая версия)...');

    // Проверяем кэш
    if (isTeamsCacheValid()) {
        console.log('[TeamsParser] Используем кэшированный список команд');
        return getCachedTeams() || [];
    }

    try {
        // Открываем страницу команд в активной вкладке для лучшей загрузки
        const tab = await openTeamsPage();

        if (!tab) {
            throw new Error('Не удалось открыть страницу команд');
        }

        // Ждем полной загрузки AJAX контента
        await waitForTeamsContentLoad(tab.id);

        // Парсим команды со страницы (быстрый метод)
        const teams = await parseTeamsFast(tab.id);

        // Закрываем вкладку
        await chrome.tabs.remove(tab.id);

        // Сохраняем в кэш
        if (teams.length > 0) {
            await saveTeamsCache(teams);
            console.log(`[TeamsParser] Сохранено в кэш: ${teams.length} команд`);
        }

        console.log(`[TeamsParser] Получено команд: ${teams.length}`);
        return teams;

    } catch (error) {
        console.error('[TeamsParser] Ошибка получения списка команд:', error);

        // Пробуем вернуть кэшированные данные
        const cachedTeams = getCachedTeams();
        if (cachedTeams && cachedTeams.length > 0) {
            console.log('[TeamsParser] Возвращаем кэшированные команды из-за ошибки');
            return cachedTeams;
        }

        return [];
    }
}

// Открытие страницы команд
async function openTeamsPage() {
    const url = CONFIG.URL_TEMPLATES.TEAMS_PAGE();

    try {
        console.log('[TeamsParser] Открываем страницу команд:', url);

        const tab = await chrome.tabs.create({
            url: url,
            active: false // Не делаем активной, чтобы не мешать пользователю
        });

        console.log(`[TeamsParser] Вкладка создана: ${tab.id}`);
        return tab;

    } catch (error) {
        console.error('[TeamsParser] Ошибка открытия страницы команд:', error);
        throw error;
    }
}

// Ожидание загрузки контента команд
async function waitForTeamsContentLoad(tabId) {
    return new Promise((resolve, reject) => {
        console.log(`[TeamsParser] Ожидаем загрузку контента команд ${tabId}...`);

        const timeout = setTimeout(() => {
            reject(new Error('Таймаут загрузки контента команд'));
        }, CONFIG.TABS.TEAMS_LOAD_TIMEOUT); // 15 секунд максимум

        let attempts = 0;
        const maxAttempts = 5;
        const checkInterval = 3000; // Проверяем каждые 3 секунды

        function checkContent() {
            attempts++;
            console.log(`[TeamsParser] Проверка загрузки ${attempts}/${maxAttempts}`);

            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    // Стратегия 1: Ищем элементы команд
                    const teamElements = document.querySelectorAll('[data-team-id], .team-item, .team-row, a[href*="#/teams/team/"]');

                    // Стратегия 2: Ищем текст с упоминанием команд
                    const pageText = document.body.innerText || '';
                    const hasTeamsText = pageText.includes('team') ||
                                        pageText.includes('Team') ||
                                        pageText.includes('команд') ||
                                        pageText.includes('Команд');

                    return {
                        teamElements: teamElements.length,
                        hasTeamsText: hasTeamsText,
                        totalTextLength: pageText.length
                    };
                }
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.log(`[TeamsParser] Ошибка проверки: ${chrome.runtime.lastError.message}`);
                    if (attempts >= maxAttempts) {
                        clearTimeout(timeout);
                        resolve(); // Все равно продолжаем
                    } else {
                        setTimeout(checkContent, checkInterval);
                    }
                    return;
                }

                if (results && results[0] && results[0].result) {
                    const data = results[0].result;
                    console.log(`[TeamsParser] Проверка: ${data.teamElements} элементов, текст: ${data.hasTeamsText}, длина: ${data.totalTextLength}`);

                    // Если нашли элементы команд или прошло много времени
                    if (data.teamElements >= 5 || data.totalTextLength > 10000 || attempts >= maxAttempts) {
                        console.log(`[TeamsParser] Контент загружен (попытка ${attempts})`);
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        // Ждем и проверяем снова
                        setTimeout(checkContent, checkInterval);
                    }
                } else {
                    if (attempts >= maxAttempts) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        setTimeout(checkContent, checkInterval);
                    }
                }
            });
        }

        // Начинаем проверку через 2 секунды после загрузки страницы
        setTimeout(checkContent, 2000);
    });
}

// Быстрый парсинг команд
async function parseTeamsFast(tabId) {
    console.log(`[TeamsParser] Быстрый парсинг команд со страницы ${tabId}...`);

    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                console.log('[TeamsParser-Fast] Начинаем быстрый парсинг всех команд...');

                const allTeams = [];
                const seenIds = new Set();
                const startTime = Date.now();

                // СТРАТЕГИЯ 1: Ищем все ссылки на команды (самый надежный способ)
                console.log('[TeamsParser-Fast] Ищем ссылки на команды...');
                const allLinks = document.querySelectorAll('a');

                allLinks.forEach(link => {
                    try {
                        const href = link.getAttribute('href') || '';

                        // Ищем ссылки на команды
                        if (href.includes('#/teams/team/')) {
                            // Извлекаем ID команды из URL
                            const idMatch = href.match(/\/team\/(\d+)/);
                            if (idMatch) {
                                const teamId = parseInt(idMatch[1]);

                                // Получаем название команды
                                let teamName = '';

                                // Пробуем разные способы получить название
                                const linkText = link.textContent.trim();
                                if (linkText && linkText.length > 1) {
                                    teamName = linkText;
                                } else {
                                    // Ищем название в соседних элементах
                                    const parent = link.parentElement;
                                    if (parent) {
                                        const parentText = parent.textContent.trim();
                                        // Удаляем ID из текста
                                        teamName = parentText.replace(new RegExp(`\\b${teamId}\\b`, 'g'), '').trim();
                                    }
                                }

                                // Очищаем название
                                if (teamName) {
                                    teamName = teamName
                                        .replace(/\s+/g, ' ')
                                        .replace(/[\n\r]+/g, ' ')
                                        .replace(/[<>]/g, '')
                                        .trim()
                                        .substring(0, 100); // Ограничиваем длину

                                    // Удаляем мусор
                                    teamName = teamName.replace(/^\d+[\.\-\s]*/, '').trim();
                                }

                                if (teamId && teamName && !seenIds.has(teamId)) {
                                    allTeams.push({
                                        id: teamId,
                                        name: teamName || `Команда ${teamId}`,
                                        url: `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}#/teams/team/${teamId}/approvals`,
                                        source: 'link'
                                    });
                                    seenIds.add(teamId);
                                }
                            }
                        }
                    } catch (error) {
                        // Игнорируем ошибки
                    }
                });

                console.log(`[TeamsParser-Fast] Найдено по ссылкам: ${allTeams.length}`);

                // СТРАТЕГИЯ 2: Ищем в таблицах (если ссылок мало)
                if (allTeams.length < 20) {
                    console.log('[TeamsParser-Fast] Ищем команды в таблицах...');
                    const tables = document.querySelectorAll('table');

                    tables.forEach(table => {
                        try {
                            // Ищем строки с ID команд
                            const rows = table.querySelectorAll('tr');
                            rows.forEach(row => {
                                const rowText = row.textContent.trim();

                                // Ищем ID команды в строке
                                const idMatch = rowText.match(/\b(\d{2,})\b/);
                                if (idMatch) {
                                    const teamId = parseInt(idMatch[1]);

                                    if (teamId && !seenIds.has(teamId)) {
                                        // Извлекаем название команды
                                        let teamName = rowText
                                            .replace(new RegExp(`\\b${teamId}\\b`, 'g'), '')
                                            .replace(/[^\w\s\-]/g, ' ')
                                            .replace(/\s+/g, ' ')
                                            .trim()
                                            .substring(0, 50);

                                        // Удаляем короткие слова
                                        teamName = teamName.split(' ')
                                            .filter(word => word.length > 2)
                                            .slice(0, 3) // Берем первые 3 слова
                                            .join(' ');

                                        if (teamName) {
                                            allTeams.push({
                                                id: teamId,
                                                name: teamName,
                                                url: `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}#/teams/team/${teamId}/approvals`,
                                                source: 'table'
                                            });
                                            seenIds.add(teamId);
                                        }
                                    }
                                }
                            });
                        } catch (error) {
                            // Игнорируем ошибки
                        }
                    });
                }

                // СТРАТЕГИЯ 3: Ищем по паттернам в тексте всей страницы
                console.log('[TeamsParser-Fast] Ищем команды в тексте страницы...');
                const pageText = document.body.innerText;

                // Ищем паттерны типа "ID: 91 НазваниеКоманды"
                const patterns = [
                    /team\/(\d{2,})[^\n\r]*?([a-zA-Z0-9\-_]+)/gi,
                    /ID[:\s]*(\d{2,})[^\n\r]*?([a-zA-Z][a-zA-Z0-9\-_]+)/gi,
                    /(\d{2,})[^\n\r]{0,20}?([a-zA-Z][a-zA-Z0-9\-_]+)/g
                ];

                patterns.forEach(pattern => {
                    let match;
                    while ((match = pattern.exec(pageText)) !== null) {
                        try {
                            const teamId = parseInt(match[1]);
                            let teamName = match[2]?.trim();

                            if (teamId && teamName && !seenIds.has(teamId)) {
                                // Очищаем название
                                teamName = teamName
                                    .replace(/[^\w\s\-]/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();

                                if (teamName.length > 1 && teamName.length < 50) {
                                    allTeams.push({
                                        id: teamId,
                                        name: teamName,
                                        url: `${CONFIG.JIRA.URL}${CONFIG.JIRA.TEMPO_BASE_PATH}#/teams/team/${teamId}/approvals`,
                                        source: 'text-pattern'
                                    });
                                    seenIds.add(teamId);
                                }
                            }
                        } catch (error) {
                            // Игнорируем ошибки
                        }
                    }
                });

                // Удаляем дубликаты и сортируем по ID
                const uniqueTeams = [];
                const finalSeenIds = new Set();

                allTeams.forEach(team => {
                    if (!finalSeenIds.has(team.id)) {
                        finalSeenIds.add(team.id);
                        uniqueTeams.push(team);
                    }
                });

                // Сортируем по ID
                uniqueTeams.sort((a, b) => a.id - b.id);

                const endTime = Date.now();
                console.log(`[TeamsParser-Fast] Парсинг завершен за ${endTime - startTime}мс. Найдено: ${uniqueTeams.length} команд`);

                // Логируем первые 10 команд
                if (uniqueTeams.length > 0) {
                    console.log('[TeamsParser-Fast] Примеры найденных команд:');
                    uniqueTeams.slice(0, 10).forEach(team => {
                        console.log(`  ${team.id}: ${team.name} (${team.source})`);
                    });
                }

                return uniqueTeams;
            }
        }, (results) => {
            if (chrome.runtime.lastError) {
                console.error('[TeamsParser] Ошибка быстрого парсинга:', chrome.runtime.lastError);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (results && results[0] && results[0].result) {
                const teams = results[0].result;
                console.log(`[TeamsParser] Быстрый парсинг завершен: ${teams.length} команд`);
                resolve(teams);
            } else {
                console.log('[TeamsParser] Быстрый парсинг не вернул результатов');
                resolve([]);
            }
        });
    });
}

// Альтернативный метод: использование Content Script
async function getTeamsViaContentScript() {
    return new Promise((resolve) => {
        chrome.tabs.create({
            url: CONFIG.URL_TEMPLATES.TEAMS_PAGE(),
            active: false
        }, (tab) => {
            if (!tab) {
                resolve([]);
                return;
            }

            // Ждем загрузки страницы
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);

                    // Даем время для загрузки AJAX
                    setTimeout(() => {
                        // Вызываем функцию из content script
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'getAllTeams'
                        }, (response) => {
                            chrome.tabs.remove(tab.id);

                            if (chrome.runtime.lastError) {
                                console.error('Ошибка получения команд:', chrome.runtime.lastError);
                                resolve([]);
                            } else {
                                resolve(response?.teams || []);
                            }
                        });
                    }, 3000);
                }
            });
        });
    });
}

// Вспомогательные функции
function findTeam(searchTerm, teams) {
    if (!searchTerm || !teams) return null;

    const searchLower = searchTerm.toLowerCase().trim();

    // Сначала ищем по точному ID
    const teamId = parseInt(searchTerm);
    if (!isNaN(teamId)) {
        const byId = teams.find(team => team.id === teamId);
        if (byId) return byId;
    }

    // Затем ищем по части имени
    const byName = teams.find(team =>
        team.name.toLowerCase().includes(searchLower)
    );

    if (byName) return byName;

    // Ищем по ID как строке
    const byIdString = teams.find(team =>
        team.id.toString().includes(searchTerm)
    );

    return byIdString || null;
}

function filterTeams(teams, searchTerm) {
    if (!searchTerm) return teams;

    const searchLower = searchTerm.toLowerCase().trim();

    return teams.filter(team =>
        team.name.toLowerCase().includes(searchLower) ||
        team.id.toString().includes(searchTerm)
    );
}

function sortTeams(teams, sortBy = 'id') {
    const sorted = [...teams];

    if (sortBy === 'id') {
        sorted.sort((a, b) => a.id - b.id);
    } else if (sortBy === 'name') {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
}

// Экспорт функций
export {
    getTeamsList,
    findTeam,
    filterTeams,
    sortTeams
};
