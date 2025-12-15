// Content script для Tempo Checker - точный парсинг таблицы

console.log('[TempoChecker] Content script загружен');

// Конфигурация будет загружена динамически
let CONFIG = null;

// Загружаем конфигурацию из background script
function loadConfig() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getConfig' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[TempoChecker] Ошибка загрузки конфигурации:', chrome.runtime.lastError);
                // Загружаем дефолтную конфигурацию из config.js
                loadDefaultConfig();
                resolve(CONFIG);
                return;
            }

            if (response && response.config) {
                CONFIG = response.config;
                console.log('[TempoChecker] Конфигурация загружена');
            } else {
                // Загружаем дефолтную конфигурацию
                loadDefaultConfig();
            }
            resolve(CONFIG);
        });
    });
}

// Загрузка дефолтной конфигурации
function loadDefaultConfig() {
    // Минимальная дефолтная конфигурация
    CONFIG = {
        JIRA: {
            URL: 'https://jira.example.com',
            TEMPO_BASE_PATH: '/secure/Tempo.jspa'
        },
        CONTENT_SCRIPTS: {
            MATCHES: ['https://jira.example.com/*']
        },
        NOTIFICATIONS: {
            ICON_URL: 'icons/icon48.png'
        }
    };
    console.log('[TempoChecker] Используется дефолтная конфигурация');
}

// Функция для проверки, находится ли страница в Tempo
function isTempoPage() {
    if (!CONFIG || !CONFIG.JIRA || !CONFIG.JIRA.URL) {
        return false;
    }

    const currentUrl = window.location.href;
    const jiraUrl = CONFIG.JIRA.URL;
    const tempoPath = CONFIG.JIRA.TEMPO_BASE_PATH || '/secure/Tempo.jspa';

    // Проверяем, что это страница нашего Jira и содержит Tempo
    return currentUrl.includes(jiraUrl) &&
           (currentUrl.includes('Tempo.jspa') ||
            currentUrl.includes('#/teams') ||
            currentUrl.includes(tempoPath));
}

// Функция для парсинга страницы Tempo
function parseTempoPage() {
    console.log('[TempoChecker-Content] Начинаем точный парсинг таблицы Tempo...');

    const allUsers = [];

    try {
        console.log('[TempoChecker-Content] URL:', window.location.href);

        // СПОСОБ 1: Парсинг по структуре из HTML (самый надежный)
        console.log('[TempoChecker-Content] Парсинг таблицы...');

        // Ищем все строки таблицы (tr элементы в tbody)
        const tableRows = document.querySelectorAll('tbody tr');
        console.log(`[TempoChecker-Content] Найдено строк в таблице: ${tableRows.length}`);

        tableRows.forEach((row, rowIndex) => {
            try {
                // Получаем ячейки таблицы
                const cells = row.querySelectorAll('td');

                if (cells.length >= 3) {
                    // Ячейка 1 (индекс 0): чекбокс - пропускаем
                    // Ячейка 2 (индекс 1): имя пользователя
                    // Ячейка 3 (индекс 2): статус

                    const nameCell = cells[1];
                    const statusCell = cells[2];

                    if (nameCell && statusCell) {
                        // Извлекаем имя из второй ячейки
                        let userName = '';

                        // Ищем div с именем или ссылку
                        const nameDiv = nameCell.querySelector('div');
                        if (nameDiv && nameDiv.textContent) {
                            userName = nameDiv.textContent.trim();
                        } else {
                            // Если нет div, берем текст ячейки
                            userName = nameCell.textContent.trim();
                        }

                        // Извлекаем статус из третьей ячейки
                        let userStatus = '';

                        // Ищем span со статусом
                        const statusSpan = statusCell.querySelector('span.sc-bDDFcn.ioVWtt');
                        if (statusSpan) {
                            userStatus = statusSpan.textContent.trim();
                        } else {
                            // Если нет span, берем текст ячейки
                            userStatus = statusCell.textContent.trim();
                        }

                        // Очищаем имя от лишних пробелов
                        userName = userName.replace(/\s+/g, ' ').trim();

                        if (userName && userStatus) {
                            allUsers.push({
                                name: userName,
                                status: userStatus,
                                rowIndex: rowIndex
                            });

                            console.log(`[TempoChecker-Content] Найден: ${userName} - ${userStatus}`);
                        }
                    }
                }
            } catch (error) {
                console.error(`[TempoChecker-Content] Ошибка строки ${rowIndex}:`, error);
            }
        });

        // СПОСОБ 2: Альтернативный поиск - по классам
        if (allUsers.length === 0) {
            console.log('[TempoChecker-Content] Альтернативный поиск по классам...');

            // Ищем все span со статусами
            const statusSpans = document.querySelectorAll('span.sc-bDDFcn.ioVWtt');
            console.log(`[TempoChecker-Content] Найдено span со статусами: ${statusSpans.length}`);

            statusSpans.forEach((span, index) => {
                try {
                    const status = span.textContent.trim();

                    // Ищем родительскую строку таблицы
                    const tableRow = span.closest('tr');
                    if (tableRow) {
                        // В этой строке ищем имя пользователя
                        // Имя обычно во второй ячейке (td)
                        const cells = tableRow.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const nameCell = cells[1];
                            let userName = '';

                            // Ищем div с именем
                            const nameDiv = nameCell.querySelector('div');
                            if (nameDiv) {
                                userName = nameDiv.textContent.trim();
                            } else {
                                userName = nameCell.textContent.trim();
                            }

                            userName = userName.replace(/\s+/g, ' ').trim();

                            if (userName) {
                                allUsers.push({
                                    name: userName,
                                    status: status,
                                    source: 'span-class'
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[TempoChecker-Content] Ошибка span ${index}:`, error);
                }
            });
        }

        // СПОСОБ 3: Поиск всех ссылок с именами
        if (allUsers.length === 0) {
            console.log('[TempoChecker-Content] Поиск по ссылкам...');

            const links = document.querySelectorAll('a[href*="#/my-work/timesheet"]');
            console.log(`[TempoChecker-Content] Найдено ссылок: ${links.length}`);

            links.forEach((link, index) => {
                try {
                    // Ищем div внутри ссылки с именем
                    const nameDiv = link.querySelector('div');
                    if (nameDiv) {
                        const userName = nameDiv.textContent.trim();

                        // Ищем статус в той же строке
                        const tableRow = link.closest('tr');
                        if (tableRow) {
                            const statusCell = tableRow.querySelector('td:nth-child(3)');
                            if (statusCell) {
                                const statusSpan = statusCell.querySelector('span.sc-bDDFcn.ioVWtt');
                                const userStatus = statusSpan ? statusSpan.textContent.trim() : statusCell.textContent.trim();

                                if (userName && userStatus) {
                                    allUsers.push({
                                        name: userName,
                                        status: userStatus,
                                        source: 'link'
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[TempoChecker-Content] Ошибка ссылки ${index}:`, error);
                }
            });
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

        console.log(`[TempoChecker-Content] Всего найдено уникальных пользователей: ${uniqueUsers.length}`);

        // Выводим для отладки
        if (uniqueUsers.length > 0) {
            console.log('[TempoChecker-Content] Найденные пользователи:');
            uniqueUsers.forEach((user, i) => {
                console.log(`  ${i + 1}. ${user.name} - ${user.status} (${user.source || 'table'})`);
            });
        } else {
            console.log('[TempoChecker-Content] Для отладки HTML структуры:');

            // Выводим первую найденную таблицу
            const firstTable = document.querySelector('table');
            if (firstTable) {
                console.log('  HTML таблицы:', firstTable.outerHTML.substring(0, 1000));
            }

            // Ищем любые span с классом sc-bDDFcn
            const testSpans = document.querySelectorAll('.sc-bDDFcn');
            console.log(`  Span с классом sc-bDDFcn: ${testSpans.length}`);

            // Ищем любые tr
            const allRows = document.querySelectorAll('tr');
            console.log(`  Всего строк (tr): ${allRows.length}`);

            // Показываем структуру первых 3 строк
            allRows.forEach((row, i) => {
                if (i < 3) {
                    console.log(`  Строка ${i}:`, row.outerHTML.substring(0, 300));
                }
            });
        }

        return uniqueUsers;

    } catch (error) {
        console.error('[TempoChecker-Content] Критическая ошибка парсинга:', error);
        return [];
    }
}

// Простая функция для быстрого парсинга через executeScript
function simpleParseTempoPage() {
    console.log('[TempoChecker-Simple] Простой парсинг таблицы...');

    const allUsers = [];

    try {
        // Ищем все строки таблицы
        const rows = document.querySelectorAll('tbody tr');

        rows.forEach(row => {
            try {
                const cells = row.querySelectorAll('td');

                if (cells.length >= 3) {
                    // Ячейка с именем (вторая)
                    const nameCell = cells[1];
                    // Ячейка со статусом (третья)
                    const statusCell = cells[2];

                    let userName = '';
                    let userStatus = '';

                    // Получаем имя
                    if (nameCell) {
                        // Ищем div с именем
                        const nameDiv = nameCell.querySelector('div');
                        userName = nameDiv ? nameDiv.textContent.trim() : nameCell.textContent.trim();
                        userName = userName.replace(/\s+/g, ' ').trim();
                    }

                    // Получаем статус
                    if (statusCell) {
                        // Ищем span со статусом
                        const statusSpan = statusCell.querySelector('span');
                        userStatus = statusSpan ? statusSpan.textContent.trim() : statusCell.textContent.trim();
                        userStatus = userStatus.replace(/\s+/g, ' ').trim();
                    }

                    if (userName && userStatus && userName.includes(' ')) {
                        allUsers.push({
                            name: userName,
                            status: userStatus
                        });
                    }
                }
            } catch (error) {
                // Игнорируем ошибки в отдельных строках
            }
        });

        console.log(`[TempoChecker-Simple] Найдено пользователей: ${allUsers.length}`);
        return allUsers;

    } catch (error) {
        console.error('[TempoChecker-Simple] Ошибка:', error);
        return [];
    }
}

// Обработчик сообщений от background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[TempoChecker-Content] Получено сообщение:', message.action);

    if (message.action === 'parseTempoPage') {
        console.log(`[TempoChecker-Content] Парсинг страницы для команды ${message.teamId}`);
        const users = parseTempoPage();
        sendResponse({ users: users });
        return true;
    }

    if (message.action === 'simpleParse') {
        console.log('[TempoChecker-Content] Простой парсинг');
        const users = simpleParseTempoPage();
        sendResponse({ users: users });
        return true;
    }

    if (message.action === 'getConfig') {
        // Возвращаем конфигурацию для других частей content script
        sendResponse({ config: CONFIG });
        return true;
    }

    return false;
});

// Инициализация конфигурации при загрузке
loadConfig().then(() => {
    // Автоматически активируемся на страницах Tempo
    if (isTempoPage()) {
        console.log('[TempoChecker] На странице Tempo, готов к парсингу');
    } else {
        console.log('[TempoChecker] Не на странице Tempo, ожидание команд');
    }
});
