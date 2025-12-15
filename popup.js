// Глобальные переменные
let allTeams = [];
let selectedTeamId = null;
let currentDate = getWeekStart(new Date());
let usersCollapsed = false;
let pluginEnabled = true;
let CONFIG = null; // Будет инициализирован после загрузки конфига

// Проверяем, загружен ли конфиг
if (!window.TEMPO_CONFIG) {
    // Если нет, загружаем скрипт динамически
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('config.js');
    script.onload = () => {
        CONFIG = window.TEMPO_CONFIG;
        document.addEventListener('DOMContentLoaded', () => {
            initPopup();
        });
    };
    script.onerror = () => {
        // Запасной конфиг если файл не загрузился
        CONFIG = getFallbackConfig();
        console.warn('Не удалось загрузить config.js, используется запасной конфиг');
        document.addEventListener('DOMContentLoaded', () => {
            initPopup();
        });
    };
    document.head.appendChild(script);
} else {
    CONFIG = window.TEMPO_CONFIG;
    document.addEventListener('DOMContentLoaded', () => {
        initPopup();
    });
}



// Форматируем дату в YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Получаем начало недели (понедельник)
function getWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    const day = d.getDay();

    // Если воскресенье (0), отнимаем 6 дней
    // Если другой день, отнимаем (день-1) дней
    const diff = day === 0 ? -6 : 1 - day;

    d.setDate(d.getDate() + diff);
    return d;
}

// Получаем конец недели (воскресенье)
function getWeekEnd(date) {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return end;
}

// Форматируем диапазон недели
function formatWeekRange(date) {
    const start = getWeekStart(date);
    const end = getWeekEnd(start);

    const startStr = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    return `${startStr} - ${endStr}`;
}

// Получаем дату для URL (понедельник недели)
function getUrlDate(date) {
    const weekStart = getWeekStart(date);
    return formatDate(weekStart);
}

// Получение JIRA_URL из конфигурации
async function loadConfig() {
    try {
        const response = await sendMessage({ type: 'GET_CONFIG' });
        if (response && response.config && response.config.JIRA_URL) {
            // Сохраняем в глобальную переменную для совместимости
            window.JIRA_URL = response.config.JIRA_URL;
            console.log('JIRA_URL загружен из конфига:', window.JIRA_URL);
        } else {
            // Используем CONFIG из загруженного файла
            window.JIRA_URL = CONFIG.JIRA.URL;
        }
    } catch (error) {
        console.log('Используем JIRA_URL из локального CONFIG');
        window.JIRA_URL = CONFIG.JIRA.URL;
    }
}

// Обновление отображения навигации по неделям
function updateWeekNavigation() {
    const weekNav = document.getElementById('week-navigation');
    const weekRange = document.getElementById('current-week-range');
    const currentDateEl = document.getElementById('current-date');

    if (!weekNav || !weekRange || !currentDateEl) return;

    weekNav.style.display = 'block';

    const weekRangeStr = formatWeekRange(currentDate);
    weekRange.textContent = `Неделя: ${weekRangeStr}`;

    const urlDate = getUrlDate(currentDate);
    currentDateEl.textContent = urlDate;

    const teamId = parseInt(document.getElementById('current-team-id')?.textContent?.replace('ID: ', '') || '91');
    const debugUrl = document.getElementById('debug-url');
    if (debugUrl) {
        debugUrl.textContent = `${CONFIG.JIRA.URL}/secure/Tempo.jspa#/teams/team/${teamId}/approvals?date=${urlDate}`;
    }
}

// Переключение видимости списка пользователей
function toggleUsersVisibility() {
    const usersSection = document.getElementById('users-section');
    const infoToggleBtn = document.getElementById('info-toggle-btn');

    if (!usersSection) return;

    usersCollapsed = !usersCollapsed;

    if (usersCollapsed) {
        usersSection.style.display = 'none';
        infoToggleBtn.innerHTML = '📋';
        infoToggleBtn.title = 'Показать список пользователей';
    } else {
        usersSection.style.display = 'block';
        infoToggleBtn.innerHTML = '?';
        infoToggleBtn.title = 'Скрыть список пользователей';
    }
}

async function initPopup() {
    showLoading(true);

    try {
        // Убедимся, что CONFIG загружен
        if (!CONFIG) {
            CONFIG = window.TEMPO_CONFIG || getFallbackConfig();
        }

        await loadConfig();
        setupGlobalKeyboardHandlers();
        setupEventListeners();

        await loadDataFromStorage();
        updateNextCheckTime();
        setupInfoPanel();
        setupSettingsButton();

        // Загружаем состояние плагина
        await loadPluginState();

    } catch (error) {
        console.error('Ошибка инициализации:', error);
        showError('Ошибка инициализации: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Функция для предотвращения навигации по истории при нажатии стрелок
function setupGlobalKeyboardHandlers() {
    document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const activeElement = document.activeElement;
            const isInSearchField = activeElement &&
                (activeElement.id === 'team-search' ||
                 activeElement.tagName === 'INPUT' ||
                 activeElement.tagName === 'TEXTAREA');

            if (!isInSearchField) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }
        return true;
    });
}

// Загрузка состояния плагина
async function loadPluginState() {
    try {
        const response = await sendMessage({ type: 'GET_PLUGIN_STATE' });
        if (response && response.success) {
            pluginEnabled = response.enabled;
            updatePluginToggle(pluginEnabled);
            updateButtonsState(pluginEnabled);
        }
    } catch (error) {
        console.error('Ошибка загрузки состояния плагина:', error);
        pluginEnabled = true; // По умолчанию включен
    }
}

// Обновление переключателя плагина
function updatePluginToggle(isEnabled) {
    const toggle = document.getElementById('plugin-toggle');
    const toggleLabel = document.getElementById('toggle-label');

    if (toggle) {
        toggle.checked = isEnabled;
    }

    if (toggleLabel) {
        toggleLabel.textContent = isEnabled ? 'Плагин включен' : 'Плагин отключен';
        toggleLabel.style.color = isEnabled ? '#51cf66' : '#ff6b6b';
    }

    // Обновляем заголовок окна
    updateWindowTitle(isEnabled);
}

// Обновление заголовка окна в зависимости от состояния плагина
function updateWindowTitle(isEnabled) {
    const titleElement = document.querySelector('.header h1');
    if (titleElement) {
        if (isEnabled) {
            titleElement.innerHTML = '⏰ Tempo Auto Checker';
        } else {
            titleElement.innerHTML = '⏰ Tempo Auto Checker <span style="color: #ff6b6b; font-size: 12px;">(отключен)</span>';
        }
    }
}

// Обновление состояния кнопок
function updateButtonsState(isEnabled) {
    const checkNowBtn = document.getElementById('check-now-btn');
    const openTempoBtn = document.getElementById('open-tempo-btn');

    if (checkNowBtn) {
        if (isEnabled) {
            checkNowBtn.disabled = false;
            checkNowBtn.style.opacity = '1';
            checkNowBtn.style.cursor = 'pointer';
            checkNowBtn.title = 'Проверить статусы Tempo сейчас';
        } else {
            checkNowBtn.disabled = true;
            checkNowBtn.style.opacity = '0.5';
            checkNowBtn.style.cursor = 'not-allowed';
            checkNowBtn.title = 'Плагин отключен. Включите плагин для проверки';
        }
    }

    // Кнопка открытия Tempo всегда доступна
    if (openTempoBtn) {
        openTempoBtn.disabled = false;
        openTempoBtn.style.opacity = '1';
        openTempoBtn.style.cursor = 'pointer';
        openTempoBtn.title = 'Открыть страницу Tempo';
    }
}

// Переключение состояния плагина
async function togglePluginState() {
    try {
        const response = await sendMessage({ type: 'TOGGLE_PLUGIN' });
        if (response && response.success) {
            pluginEnabled = response.enabled;
            updatePluginToggle(pluginEnabled);
            updateButtonsState(pluginEnabled);

            // Показываем сообщение
            if (pluginEnabled) {
                showInfo('✅ Плагин включен. Автоматические проверки возобновлены.');
            } else {
                showInfo('⏸️ Плагин отключен. Автоматические проверки приостановлены.');
            }

            return true;
        } else {
            showError('Ошибка переключения плагина: ' + (response?.error || 'Неизвестная ошибка'));
            return false;
        }
    } catch (error) {
        console.error('Ошибка переключения плагина:', error);
        showError('Ошибка переключения плагина: ' + error.message);
        return false;
    }
}

async function loadDataFromStorage() {
    try {
        const response = await sendMessage({ type: 'GET_TEMPO_DATA' });

        if (response && response.success) {
            if (response.isAuthenticated !== undefined) {
                updateAuthInfoInMainBlock(response.isAuthenticated,
                    response.isAuthenticated ? 'Авторизация есть' : 'Требуется авторизация в Jira');
            }

            if (response.data) {
                updateTeamDisplay({
                    teamId: response.data.teamId,
                    teamName: response.data.teamName
                });

                updateDebugInfo(response.data);
                displayData(response.data);
            }
        } else {
            const [tempoDataResult, settingsResult] = await Promise.all([
                chrome.storage.local.get(['tempoData']),
                chrome.storage.local.get(['tempoSettings'])
            ]);

            const tempoData = tempoDataResult.tempoData || {};
            const settings = settingsResult.tempoSettings || {
                teamId: 91,
                teamName: 'stream1-team'
            };

            updateTeamDisplay(settings);
            updateDebugInfo(settings);
            await checkAndDisplayAuth();
            displayData(tempoData);
        }

    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        throw error;
    }
}

async function checkAndDisplayAuth() {
    try {
        const response = await sendMessage({ type: 'CHECK_AUTH' });

        if (response && response.success) {
            updateAuthInfoInMainBlock(response.isAuthenticated, response.message);

            if (response.isAuthenticated) {
                await loadDataFromStorage();
            }
        } else {
            updateAuthInfoInMainBlock(false, 'Не удалось проверить авторизацию');
        }
    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        updateAuthInfoInMainBlock(false, 'Не удалось проверить авторизацию');
    }
}

// Функция обновления информации об авторизации в основном блоке
function updateAuthInfoInMainBlock(isAuthenticated, message) {
    const checkNowBtn = document.getElementById('check-now-btn');
    if (!checkNowBtn) return;

    if (!pluginEnabled) {
        checkNowBtn.innerHTML = '⏸️ Плагин отключен';
        checkNowBtn.title = 'Плагин отключен. Включите плагин для проверки';
        return;
    }

    if (isAuthenticated) {
        checkNowBtn.innerHTML = '🔄 Проверить сейчас';
        checkNowBtn.title = 'Проверить статусы Tempo сейчас (авторизация есть)';
    } else {
        checkNowBtn.innerHTML = '🔐 Требуется авторизация';
        checkNowBtn.title = 'Требуется авторизация в Jira. Нажмите, чтобы открыть Jira и авторизоваться';
    }
}

function updateTeamDisplay(settings) {
    const teamNameEl = document.getElementById('current-team-name');
    const teamIdEl = document.getElementById('current-team-id');

    if (teamNameEl) {
        teamNameEl.textContent = settings.teamName || `Команда ${settings.teamId}`;
    }
    if (teamIdEl) {
        teamIdEl.textContent = `ID: ${settings.teamId}`;
    }
}

function updateDebugInfo(data) {
    const teamId = data?.teamId || 91;
    const teamName = data?.teamName || 'stream1-team';

    const debugTeamId = document.getElementById('debug-team-id');
    const debugUrl = document.getElementById('debug-url');

    if (debugTeamId) {
        debugTeamId.textContent = teamId;
    }
    if (debugUrl) {
        const urlDate = getUrlDate(currentDate);
        debugUrl.textContent =
            `${CONFIG.JIRA.URL}/secure/Tempo.jspa#/teams/team/${teamId}/approvals?date=${urlDate}`;
    }
}

function displayData(data) {
    const notSubmittedCount = data.notSubmittedUsers?.length || 0;
    const totalCount = data.totalCount || data.allUsers?.length || 0;

    updateLastCheckTime(data.lastCheck);
    updateWeekNavigation();
    updateCompactStatus(notSubmittedCount, totalCount);

    const usersSection = document.getElementById('users-section');

    if (notSubmittedCount > 0 || (data.allUsers && data.allUsers.length > 0)) {
        if (!usersCollapsed) {
            if (usersSection) usersSection.style.display = 'block';
        }
        displayAllUsers(data.allUsers || data.notSubmittedUsers, notSubmittedCount, totalCount);
    } else {
        if (usersSection) usersSection.style.display = 'none';
    }

    clearErrors();
}

function updateCompactStatus(notSubmittedCount, totalCount) {
    const compactSection = document.getElementById('compact-status-section');
    const compactCount = document.getElementById('compact-count');
    const compactTotal = document.getElementById('compact-total');

    if (!compactSection || !compactCount || !compactTotal) return;

    if (notSubmittedCount > 0 || totalCount > 0) {
        compactSection.style.display = 'block';
        compactCount.textContent = notSubmittedCount;
        compactTotal.textContent = totalCount;

        const statusDot = document.querySelector('.status-dot');
        if (statusDot) {
            if (notSubmittedCount >= 10) {
                statusDot.style.background = '#ff6b6b';
            } else if (notSubmittedCount >= 5) {
                statusDot.style.background = '#ffa94d';
            } else if (notSubmittedCount > 0) {
                statusDot.style.background = '#ffd43b';
            } else {
                statusDot.style.background = '#51cf66';
            }
        }
    } else {
        compactSection.style.display = 'none';
    }
}

function setupInfoPanel() {
    const infoToggleBtn = document.getElementById('info-toggle-btn');
    const infoPanel = document.getElementById('info-panel');

    if (infoToggleBtn) {
        infoToggleBtn.addEventListener('click', () => {
            const isInfoVisible = infoPanel.style.display === 'block';

            if (isInfoVisible) {
                infoPanel.style.display = 'none';
                infoToggleBtn.innerHTML = '?';
                infoToggleBtn.title = 'Показать информацию';
            } else {
                infoPanel.style.display = 'block';
                toggleUsersVisibility();
                infoToggleBtn.innerHTML = '📋';
                infoToggleBtn.title = 'Показать список пользователей';
            }
        });
    }
}

function setupWeekNavigation() {
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');

    if (prevWeekBtn) {
        prevWeekBtn.addEventListener('click', (event) => {
            const newDate = new Date(currentDate);
            newDate.setDate(newDate.getDate() - 7);
            currentDate = getWeekStart(newDate);
            updateWeekNavigation();
        });
    }

    if (nextWeekBtn) {
        nextWeekBtn.addEventListener('click', (event) => {
            const newDate = new Date(currentDate);
            newDate.setDate(newDate.getDate() + 7);
            currentDate = getWeekStart(newDate);
            updateWeekNavigation();
        });
    }
}

function setupSettingsButton() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const cancelSettingsBtn = document.getElementById('cancel-settings-btn');

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
            // loadSettings() будет вызван из settings-manager.js
        });
    }

    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }

    if (cancelSettingsBtn && settingsModal) {
        cancelSettingsBtn.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }
}

async function checkNowWithAuth() {
    // Проверяем включен ли плагин
    if (!pluginEnabled) {
        showError('Плагин отключен. Включите плагин для проверки Tempo.');
        return;
    }

    const button = document.getElementById('check-now-btn');
    if (!button) return;

    const originalText = button.innerHTML;
    const originalTitle = button.title;

    try {
        // Шаг 1: Проверяем авторизацию
        button.innerHTML = '🔐 Проверяем авторизацию...';
        button.title = 'Проверка авторизации...';

        const authResponse = await sendMessage({ type: 'CHECK_AUTH' });

        if (!authResponse || !authResponse.success || !authResponse.isAuthenticated) {
            button.innerHTML = '❌ Нет авторизации';
            button.title = 'Требуется авторизация в Jira';

            // Показываем уведомление о необходимости авторизации
            await showNotificationDirectly(
                'Tempo Checker: Требуется авторизация',
                'Откройте Jira и войдите в систему. Проверка будет продолжена автоматически через 5 секунд.',
                true
            );

            // Открываем Jira для авторизации
            chrome.tabs.create({
                url: CONFIG.JIRA.URL,
                active: true
            });

            // Ждем 5 секунд и снова проверяем авторизацию
            setTimeout(async () => {
                try {
                    // Проверяем авторизацию снова
                    const recheckResponse = await sendMessage({ type: 'CHECK_AUTH' });

                    if (recheckResponse && recheckResponse.success && recheckResponse.isAuthenticated) {
                        // Авторизация появилась, продолжаем проверку
                        button.innerHTML = '✅ Авторизация успешна';
                        button.title = 'Авторизация прошла успешно, продолжаем проверку...';

                        // Ждем еще секунду и выполняем проверку
                        setTimeout(async () => {
                            await performTempoCheck();
                        }, 1000);
                    } else {
                        // Авторизация все еще отсутствует
                        updateAuthInfoInMainBlock(false, 'Требуется авторизация в Jira');
                        button.innerHTML = '🔐 Требуется авторизация';
                        button.title = 'Требуется авторизация в Jira. Нажмите, чтобы открыть Jira и авторизоваться';

                        // Показываем уведомление о неудачной авторизации
                        await showNotificationDirectly(
                            'Tempo Checker: Авторизация не удалась',
                            'Не удалось проверить авторизацию. Убедитесь, что вы вошли в Jira.',
                            true
                        );
                    }
                } catch (recheckError) {
                    console.error('Ошибка повторной проверки авторизации:', recheckError);
                    button.innerHTML = '🔐 Требуется авторизация';
                    button.title = 'Требуется авторизация в Jira. Нажмите, чтобы открыть Jira и авторизоваться';
                }
            }, 5000);

            return;
        }

        // Шаг 2: Авторизация есть, запускаем проверку
        await performTempoCheck();

    } catch (error) {
        console.error('Ошибка проверки:', error);
        button.innerHTML = '❌ Ошибка';
        button.title = 'Произошла ошибка';

        // Показываем уведомление об ошибке
        await showNotificationDirectly(
            'Tempo Checker: Ошибка проверки',
            `Не удалось выполнить проверку: ${error.message}`,
            false
        );

        setTimeout(() => {
            button.innerHTML = originalText;
            button.title = originalTitle;
        }, 2000);

        showError('Ошибка: ' + error.message);
    }
}

// Функция для выполнения проверки Tempo
async function performTempoCheck() {
    const button = document.getElementById('check-now-btn');
    if (!button) return;

    try {
        button.innerHTML = '🔄 Проверяем статусы...';
        button.title = 'Проверка статусов Tempo...';

        const teamId = parseInt(document.getElementById('current-team-id')?.textContent?.replace('ID: ', '') || '91');
        const dateStr = getUrlDate(currentDate);

        const response = await sendMessage({
            type: 'CHECK_TEMPO_NOW',
            date: dateStr,
            teamId: teamId
        });

        if (response && response.success) {
            button.innerHTML = '✅ Проверено!';
            button.title = 'Проверка завершена';

            setTimeout(() => {
                displayData({
                    notSubmittedUsers: response.users,
                    allUsers: response.allUsers,
                    lastCheck: response.lastCheck,
                    totalCount: response.totalCount || response.count
                });

                updateAuthInfoInMainBlock(true, 'Авторизация есть');
                button.innerHTML = '🔄 Проверить сейчас';
                button.title = 'Проверить статусы Tempo сейчас';

                // Если есть неподтвержденные, уведомление уже показано в tempo-checker.js
                // Если все отправили, можно показать информационное уведомление
                if (response.count === 0 && response.totalCount > 0) {
                    showInfo('Все участники команды отправили Tempo на этой неделе! 🎉');
                }
            }, 1000);

        } else {
            button.innerHTML = '❌ Ошибка проверки';
            button.title = 'Ошибка при проверке';

            // Показываем уведомление об ошибке проверки
            if (response?.error) {
                await showNotificationDirectly(
                    'Tempo Checker: Ошибка проверки',
                    `Не удалось получить данные: ${response.error}`,
                    false
                );
            }

            setTimeout(() => {
                button.innerHTML = '🔄 Проверить сейчас';
                button.title = 'Проверить статусы Tempo сейчас';
            }, 2000);

            showError('Ошибка при проверке: ' + (response?.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка проверки:', error);
        button.innerHTML = '❌ Ошибка';
        button.title = 'Произошла ошибка';

        await showNotificationDirectly(
            'Tempo Checker: Критическая ошибка',
            `Произошла ошибка при проверке: ${error.message}`,
            false
        );

        setTimeout(() => {
            button.innerHTML = '🔄 Проверить сейчас';
            button.title = 'Проверить статусы Tempo сейчас';
        }, 2000);

        showError('Ошибка: ' + error.message);
    }
}

// Функция для показа уведомлений
async function showNotificationDirectly(title, message, requireInteraction = false) {
    try {
        await chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: title,
            message: message,
            priority: 2,
            requireInteraction: requireInteraction,
            silent: false
        });
        console.log(`Уведомление показано: ${title} - ${message}`);
    } catch (error) {
        console.error('Ошибка показа уведомления:', error);
    }
}

function displayAllUsers(allUsers, notSubmittedCount, totalCount) {
    const container = document.getElementById('users-list');

    if (!container) return;

    if (!allUsers || allUsers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="text-align: center; padding: 20px; color: #666;">
                    <p>Не удалось загрузить список участников</p>
                    <p style="font-size: 12px; margin-top: 10px;">
                        Попробуйте:<br>
                        1. Проверить авторизацию в Jira<br>
                        2. Нажать "Открыть Tempo" и проверить доступность страницы<br>
                        3. Обновить страницу команды в браузере
                    </p>
                    <p style="font-size: 11px; color: #999; margin-top: 10px;">
                        Если страница открывается, но список пустой,<br>
                        проверьте консоль расширения (F12 → Вкладка Console)
                    </p>
                </div>
            </div>
        `;
        return;
    }

    // Сортируем: сначала "Открыт", потом другие статусы, по алфавиту
    const sortedUsers = [...allUsers].sort((a, b) => {
        const statusA = a.status.toUpperCase();
        const statusB = b.status.toUpperCase();

        const isAOpen = statusA.includes('ОТКРЫТ') || statusA.includes('OPEN');
        const isBOpen = statusB.includes('ОТКРЫТ') || statusB.includes('OPEN');

        if (isAOpen && !isBOpen) return -1;
        if (!isAOpen && isBOpen) return 1;

        return a.name.localeCompare(b.name);
    });

    // Обновляем заголовок
    const sectionTitle = document.querySelector('.section-title');
    if (sectionTitle) {
        const readyCount = totalCount - notSubmittedCount;
        const weekRange = formatWeekRange(currentDate);
        sectionTitle.innerHTML = `
            <span>Участники команды (${totalCount}) - ${weekRange}</span>
            <div style="display: flex; gap: 8px;">
                <span class="badge" style="background: #ff6b6b;">
                    ${notSubmittedCount} не отправили
                </span>
                <span class="badge" style="background: #51cf66;">
                    ${readyCount} отправили
                </span>
            </div>
        `;
    }

    // Создаем табличный вид
    container.innerHTML = `
        <div style="margin-bottom: 10px; font-size: 12px; color: #666; display: flex; justify-content: space-between; padding: 0 5px;">
            <span style="flex: 1;">Имя участника</span>
            <span style="min-width: 80px; text-align: right;">Статус</span>
        </div>
        ${sortedUsers.map(user => {
            const status = user.status.toUpperCase();
            const isNotSubmitted = status.includes('ОТКРЫТ') ||
                                  status.includes('OPEN') ||
                                  status.includes('НЕ ОТПРАВЛЕН');

            const statusColor = isNotSubmitted ? '#ff6b6b' : '#51cf66';
            const statusText = getStatusText(user.status);
            const statusIcon = isNotSubmitted ? '🔴' : '🟢';

            return `
                <div class="user-item" style="border-left-color: ${statusColor}; display: flex; justify-content: space-between; align-items: center;">
                    <span class="user-name" title="${user.name}" style="flex: 1;">
                        ${user.name}
                    </span>
                    <span class="user-status" style="background: ${statusColor}; display: flex; align-items: center; gap: 4px; min-width: 80px; justify-content: center;">
                        ${statusIcon}
                        ${statusText}
                    </span>
                </div>
            `;
        }).join('')}

        <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px; font-size: 12px; color: #666;">
            <strong>📝 Пояснение статусов:</strong>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                <span style="display: inline-block; width: 12px; height: 12px; background: #ff6b6b; border-radius: 50%;"></span>
                <span><strong>Открыт</strong> - Tempo не отправлен на согласование</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
                <span style="display: inline-block; width: 12px; height: 12px; background: #51cf66; border-radius: 50%;"></span>
                <span><strong>Готов</strong> - Tempo отправлен на согласование</span>
            </div>
        </div>
    `;
}

function getStatusText(status) {
    if (!status) return 'Неизвестно';

    const statusMap = {
        'ОТКРЫТ': 'Открыт',
        'ОТКРЫТО': 'Открыт',
        'ГОТОВ': 'Готов',
        'НЕ ОТПРАВЛЕН': 'Не отправлен',
        'OPEN': 'Открыт',
        'READY': 'Готов',
        'NOT SUBMITTED': 'Не отправлен'
    };

    return statusMap[status] || status;
}

function openTempoPage() {
    const teamId = parseInt(document.getElementById('current-team-id')?.textContent?.replace('ID: ', '') || '91');
    const urlDate = getUrlDate(currentDate);
    const url = `${CONFIG.JIRA.URL}/secure/Tempo.jspa#/teams/team/${teamId}/approvals?date=${urlDate}`;

    chrome.tabs.create({ url: url });
}

function updateLastCheckTime(lastCheck) {
    const element = document.getElementById('last-check-time');
    if (!element) return;

    if (!lastCheck) {
        element.textContent = '-';
        return;
    }

    try {
        const date = new Date(lastCheck);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            element.textContent = 'только что';
        } else if (diffMins < 60) {
            element.textContent = `${diffMins} мин назад`;
        } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            element.textContent = `${hours} ч назад`;
        } else {
            element.textContent = date.toLocaleDateString() + ' ' +
                                 date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }
    } catch (error) {
        element.textContent = '-';
    }
}

function updateNextCheckTime() {
    const element = document.getElementById('next-check-time');
    if (!element) return;

    const now = new Date();
    const nextCheck = new Date();
    nextCheck.setHours(17, 0, 0, 0);

    if (now > nextCheck) {
        nextCheck.setDate(nextCheck.getDate() + 1);
    }

    element.textContent = nextCheck.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

async function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

function showLoading(show) {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('content');

    if (loadingEl) loadingEl.style.display = show ? 'block' : 'none';
    if (contentEl) contentEl.style.display = show ? 'none' : 'block';
}

function showError(message) {
    const container = document.getElementById('error-container');
    if (!container) return;

    container.innerHTML = `
        <div class="error-message">
            <strong>❌ Ошибка:</strong> ${message}
        </div>
    `;
}

function showInfo(message) {
    const container = document.getElementById('error-container');
    if (!container) return;

    container.innerHTML = `
        <div class="error-message" style="background: #e3f2fd; border-color: #2196f3; color: #1565c0;">
            <strong>ℹ️ Информация:</strong> ${message}
        </div>
    `;
}

function clearErrors() {
    const container = document.getElementById('error-container');
    if (container) container.innerHTML = '';
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Основные кнопки
    const checkNowBtn = document.getElementById('check-now-btn');
    const openTempoBtn = document.getElementById('open-tempo-btn');

    if (checkNowBtn) checkNowBtn.addEventListener('click', checkNowWithAuth);
    if (openTempoBtn) openTempoBtn.addEventListener('click', openTempoPage);

    // Переключатель плагина
    const pluginToggle = document.getElementById('plugin-toggle');
    if (pluginToggle) {
        pluginToggle.addEventListener('change', togglePluginState);
    }

    // Кнопки выбора команды
    const changeTeamBtn = document.getElementById('change-team-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelTeamBtn = document.getElementById('cancel-team-btn');
    const selectTeamBtn = document.getElementById('select-team-btn');
    const refreshTeamsBtn = document.getElementById('refresh-teams-btn');

    if (changeTeamBtn) changeTeamBtn.addEventListener('click', showTeamSelector);
    if (closeModalBtn) closeModalBtn.addEventListener('click', hideTeamSelector);
    if (cancelTeamBtn) cancelTeamBtn.addEventListener('click', hideTeamSelector);
    if (selectTeamBtn) selectTeamBtn.addEventListener('click', selectTeam);
    if (refreshTeamsBtn) refreshTeamsBtn.addEventListener('click', refreshTeamsList);

    // Поиск команд
    const teamSearch = document.getElementById('team-search');
    if (teamSearch) teamSearch.addEventListener('input', filterTeams);

    // Отладочная кнопка
    const debugRefreshBtn = document.getElementById('debug-refresh-btn');
    if (debugRefreshBtn) {
        debugRefreshBtn.addEventListener('click', () => {
            loadDataFromStorage().catch(console.error);
        });
    }

    setupWeekNavigation();

    // Обновляем время каждую минуту
    setInterval(() => {
        updateNextCheckTime();
    }, 60000);
}

// Функции для выбора команды
async function showTeamSelector() {
    const modal = document.getElementById('team-modal');
    if (modal) modal.style.display = 'flex';

    await loadTeamsList();
}

function hideTeamSelector() {
    const modal = document.getElementById('team-modal');
    if (modal) modal.style.display = 'none';

    selectedTeamId = null;
    const selectBtn = document.getElementById('select-team-btn');
    if (selectBtn) selectBtn.disabled = true;

    const searchInput = document.getElementById('team-search');
    if (searchInput) searchInput.value = '';
}

async function loadTeamsList() {
    const teamsList = document.getElementById('teams-list');
    if (!teamsList) return;

    teamsList.innerHTML = `
        <div class="loading-teams">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
            <p>Загружаем список команд из файла...</p>
        </div>
    `;

    try {
        const response = await sendMessage({ type: 'GET_TEAMS' });

        if (response && response.success && response.teams) {
            allTeams = response.teams;
            renderTeamsList(allTeams, `Загружено ${allTeams.length} команд из файла`);

        } else {
            renderTeamsList([], '⚠️ Не удалось загрузить команды. Проверьте файл teams.json');
        }

    } catch (error) {
        console.error('Ошибка загрузки списка команд:', error);
        renderTeamsList([], '⚠️ Ошибка загрузки: ' + error.message);
    }
}

async function refreshTeamsList() {
    const teamsList = document.getElementById('teams-list');
    if (!teamsList) return;

    teamsList.innerHTML = `
        <div class="loading-teams">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
            <p>Обновляем список команд...</p>
        </div>
    `;

    try {
        const response = await sendMessage({ type: 'REFRESH_TEAMS' });

        if (response && response.success) {
            allTeams = response.teams || [];
            renderTeamsList(allTeams, response.message || 'Список команд обновлен');
        } else {
            renderTeamsList([], response?.error || 'Не удалось обновить список команд');
        }
    } catch (error) {
        console.error('Ошибка обновления списка команд:', error);
        renderTeamsList([], 'Ошибка обновления: ' + error.message);
    }
}

function renderTeamsList(teams, infoMessage = '') {
    const teamsList = document.getElementById('teams-list');
    if (!teamsList) return;

    teamsList.innerHTML = '';

    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = `
        padding: 10px 15px;
        background: #f8f9fa;
        border-bottom: 1px solid #e9ecef;
        font-size: 12px;
        color: #666;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    headerDiv.innerHTML = `
        <span>Найдено команд: <strong>${teams.length}</strong></span>
        <button id="refresh-teams-header" style="
            background: none;
            border: none;
            color: #667eea;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            border-radius: 4px;
        ">
            🔄 Обновить
        </button>
    `;
    teamsList.appendChild(headerDiv);

    const refreshHeaderBtn = document.getElementById('refresh-teams-header');
    if (refreshHeaderBtn) {
        refreshHeaderBtn.addEventListener('click', refreshTeamsList);
    }

    if (infoMessage) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'teams-info-message';
        infoDiv.style.cssText = `
            padding: 10px;
            margin: 10px;
            background: #e3f2fd;
            border-radius: 6px;
            border-left: 4px solid #2196f3;
            font-size: 12px;
            color: #1565c0;
        `;
        infoDiv.textContent = infoMessage;
        teamsList.appendChild(infoDiv);
    }

    const tipDiv = document.createElement('div');
    tipDiv.style.cssText = `
        padding: 8px 15px;
        background: #fff3cd;
        border-left: 4px solid #ffc107;
        font-size: 11px;
        color: #856404;
        margin: 10px;
        border-radius: 4px;
    `;
    tipDiv.innerHTML = `
        <strong>💡 Советы по поиску:</strong><br>
        1. Ищите по ID (например: "91")<br>
        2. Ищите по названию (например: "stream1")<br>
        3. Команды загружаются из файла teams.json
    `;
    teamsList.appendChild(tipDiv);

    if (!teams || teams.length === 0) {
        const noTeamsDiv = document.createElement('div');
        noTeamsDiv.className = 'no-teams';
        noTeamsDiv.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #666;">
                <p style="margin-bottom: 15px;">Команды не найдены</p>
                <p style="font-size: 12px; margin-bottom: 20px;">
                    Проверьте файл teams.json в папке расширения
                </p>
                <button id="refresh-teams-action" style="
                    padding: 8px 16px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 12px;
                ">
                    🔄 Повторить загрузку
                </button>
            </div>
        `;
        teamsList.appendChild(noTeamsDiv);

        const refreshBtn = document.getElementById('refresh-teams-action');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', refreshTeamsList);
        }
        return;
    }

    const listContainer = document.createElement('div');
    listContainer.style.maxHeight = '200px';
    listContainer.style.overflowY = 'auto';
    listContainer.style.border = '1px solid #e9ecef';
    listContainer.style.borderRadius = '6px';

    teams.sort((a, b) => a.id - b.id);

    // Добавляем пустое поле для новой команды
    const emptyTeamItem = document.createElement('div');
    emptyTeamItem.className = 'team-item';
    emptyTeamItem.style.cssText = `
        padding: 12px 15px;
        border-bottom: 1px solid #f1f3f5;
        background: #f8f9fa;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    emptyTeamItem.innerHTML = `
        <div style="flex: 1;">
            <div class="team-item-name" style="font-weight: 500; color: #333; margin-bottom: 2px;">
                <input type="number" class="team-input team-id-input" placeholder="ID" style="width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                <input type="text" class="team-input team-name-input" placeholder="Название команды" style="width: 200px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; margin-left: 10px;">
            </div>
            <div class="team-item-id" style="font-size: 11px; color: #666;">Новая команда</div>
        </div>
        <div style="color: #999; font-size: 12px; margin-left: 10px;">＋</div>
    `;

    listContainer.appendChild(emptyTeamItem);

    teams.forEach(team => {
        const teamItem = document.createElement('div');
        teamItem.className = 'team-item';
        teamItem.dataset.teamId = team.id;
        teamItem.style.cssText = `
            padding: 12px 15px;
            border-bottom: 1px solid #f1f3f5;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        `;

        const currentTeamId = parseInt(document.getElementById('current-team-id')?.textContent?.replace('ID: ', '') || '0');
        const isCurrentTeam = team.id === currentTeamId;

        if (isCurrentTeam) {
            teamItem.style.backgroundColor = '#e7f3ff';
            teamItem.style.borderLeft = '3px solid #667eea';
        }

        teamItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div class="team-item-name" style="font-weight: 500; color: #333; margin-bottom: 2px;">
                        ${team.name}
                        ${isCurrentTeam ? '<span style="font-size: 10px; background: #667eea; color: white; padding: 1px 6px; border-radius: 10px; margin-left: 8px;">текущая</span>' : ''}
                    </div>
                    <div class="team-item-id" style="font-size: 11px; color: #666;">ID: ${team.id}</div>
                </div>
                <div style="color: #999; font-size: 12px; margin-left: 10px;">▶</div>
            </div>
        `;

        teamItem.addEventListener('mouseenter', () => {
            if (!teamItem.classList.contains('selected')) {
                teamItem.style.backgroundColor = '#f8f9fa';
            }
        });

        teamItem.addEventListener('mouseleave', () => {
            if (!teamItem.classList.contains('selected') && !isCurrentTeam) {
                teamItem.style.backgroundColor = '';
            }
        });

        teamItem.addEventListener('click', () => {
            document.querySelectorAll('.team-item').forEach(i => {
                i.classList.remove('selected');
                if (!i.style.backgroundColor.includes('e7f3ff')) {
                    i.style.backgroundColor = '';
                }
            });

            teamItem.classList.add('selected');
            teamItem.style.backgroundColor = '#e7f3ff';
            selectedTeamId = parseInt(teamItem.dataset.teamId);

            const selectBtn = document.getElementById('select-team-btn');
            if (selectBtn) selectBtn.disabled = false;
        });

        listContainer.appendChild(teamItem);
    });

    teamsList.appendChild(listContainer);

    const footerDiv = document.createElement('div');
    footerDiv.style.cssText = `
        padding: 10px 15px;
        background: #f8f9fa;
        border-top: 1px solid #e9ecef;
        font-size: 11px;
        color: #666;
        text-align: center;
    `;
    footerDiv.textContent = `Для поиска используйте поле выше. Команды загружаются из файла.`;
    teamsList.appendChild(footerDiv);

    // Добавляем обработчик для пустого поля
    const addTeamBtn = emptyTeamItem.querySelector('.team-name-input');
    if (addTeamBtn) {
        addTeamBtn.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                const idInput = emptyTeamItem.querySelector('.team-id-input');
                const nameInput = emptyTeamItem.querySelector('.team-name-input');

                if (idInput && nameInput && idInput.value && nameInput.value) {
                    const newTeam = {
                        id: parseInt(idInput.value),
                        name: nameInput.value.trim()
                    };

                    idInput.value = '';
                    nameInput.value = '';
                    nameInput.focus();
                }
            }
        });
    }
}

function filterTeams() {
    const searchInput = document.getElementById('team-search');
    if (!searchInput) return;

    const searchText = searchInput.value.toLowerCase().trim();

    if (!searchText) {
        renderTeamsList(allTeams);
        return;
    }

    const filtered = allTeams.filter(team => {
        const searchStr = searchText.toLowerCase();
        return (
            team.name.toLowerCase().includes(searchStr) ||
            team.id.toString().includes(searchStr)
        );
    });

    const message = filtered.length === 0 ?
        `Не найдено команд по запросу: "${searchText}"` :
        `Найдено команд: ${filtered.length}`;

    renderTeamsList(filtered, message);
}

async function selectTeam() {
    if (!selectedTeamId) return;

    const selectedTeam = allTeams.find(team => team.id === selectedTeamId);
    if (!selectedTeam) return;

    try {
        const response = await sendMessage({
            type: 'UPDATE_TEAM',
            teamId: selectedTeam.id,
            teamName: selectedTeam.name
        });

        if (response && response.success) {
            updateTeamDisplay(selectedTeam);
            updateDebugInfo(selectedTeam);
            hideTeamSelector();
            await loadDataFromStorage();
            showInfo(`Команда изменена на: ${selectedTeam.name}`);
        } else {
            showError('Ошибка обновления команды: ' + (response?.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        showError('Ошибка обновления команды: ' + error.message);
    }
}

// Обновление при возвращении на вкладку
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        loadDataFromStorage().catch(console.error);
    }
});
