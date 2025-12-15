// Модуль управления настройками

const DEFAULT_SETTINGS = {
    checkTime: '17:00',
    checkInterval: 'daily',
    checkDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    teams: [
        { id: 91, name: 'stream1-team' },
        { id: 92, name: 'stream2-team' },
        { id: 93, name: 'stream3-team' },
        { id: 94, name: 'stream4-team' },
        { id: 95, name: 'backend-team' }
    ]
};

// Загрузка настроек
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get('appSettings');
        const settings = result.appSettings || DEFAULT_SETTINGS;

        // Применяем настройки к UI
        applySettingsToUI(settings);

        return settings;
    } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
        applySettingsToUI(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
}

// Применение настроек к UI
function applySettingsToUI(settings) {
    // Время проверки
    const checkTimeInput = document.getElementById('check-time');
    if (checkTimeInput) {
        checkTimeInput.value = settings.checkTime || '17:00';
    }

    // Интервал проверки
    const checkIntervalSelect = document.getElementById('check-interval');
    if (checkIntervalSelect) {
        checkIntervalSelect.value = settings.checkInterval || 'daily';
    }

    // Дни недели
    const dayButtons = document.querySelectorAll('.day-btn');
    dayButtons.forEach(btn => {
        const day = btn.dataset.day;
        if (settings.checkDays && settings.checkDays.includes(day)) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });

    // Команды
    renderTeamsEditor(settings.teams || DEFAULT_SETTINGS.teams);
}

// Рендер редактора команд
function renderTeamsEditor(teams) {
    const teamsEditor = document.getElementById('teams-editor');
    if (!teamsEditor) return;

    teamsEditor.innerHTML = '';

    teams.forEach((team, index) => {
        const teamItem = document.createElement('div');
        teamItem.className = 'team-editor-item';
        teamItem.innerHTML = `
            <input type="number" class="team-input team-id-input" value="${team.id}" placeholder="ID">
            <input type="text" class="team-input team-name-input" value="${team.name}" placeholder="Название команды">
            <button class="remove-team-btn" data-index="${index}">×</button>
        `;
        teamsEditor.appendChild(teamItem);
    });

    setupTeamsEditorEvents();
}

// Настройка событий редактора команд
function setupTeamsEditorEvents() {
    // Кнопка добавления команды
    const addTeamBtn = document.getElementById('add-team-btn');
    if (addTeamBtn) {
        addTeamBtn.addEventListener('click', () => {
            const teamsEditor = document.getElementById('teams-editor');
            if (!teamsEditor) return;

            const teamItem = document.createElement('div');
            teamItem.className = 'team-editor-item';
            teamItem.innerHTML = `
                <input type="number" class="team-input team-id-input" value="" placeholder="ID">
                <input type="text" class="team-input team-name-input" value="" placeholder="Название команды">
                <button class="remove-team-btn">×</button>
            `;
            teamsEditor.appendChild(teamItem);

            // Назначаем обработчик удаления для новой кнопки
            const removeBtn = teamItem.querySelector('.remove-team-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', function() {
                    teamItem.remove();
                });
            }
        });
    }

    // Кнопки удаления команд
    const removeButtons = document.querySelectorAll('.remove-team-btn');
    removeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.team-editor-item').remove();
        });
    });

    // Кнопки дней недели
    const dayButtons = document.querySelectorAll('.day-btn');
    dayButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('selected');
        });
    });
}

// Сохранение настроек
async function saveSettings() {
    try {
        const settings = collectSettingsFromUI();

        // Сохраняем в хранилище
        await chrome.storage.local.set({ appSettings: settings });

        // Сохраняем команды в teams.json через фоновый скрипт
        await chrome.runtime.sendMessage({
            type: 'SAVE_TEAMS',
            teams: settings.teams
        });

        // Обновляем настройки автопроверки
        await chrome.runtime.sendMessage({
            type: 'UPDATE_AUTO_CHECK_SETTINGS',
            settings: {
                checkTime: settings.checkTime,
                checkInterval: settings.checkInterval,
                checkDays: settings.checkDays
            }
        });

        console.log('Настройки сохранены:', settings);
        return { success: true };

    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        return { success: false, error: error.message };
    }
}

// Сбор настроек из UI
function collectSettingsFromUI() {
    // Время проверки
    const checkTimeInput = document.getElementById('check-time');
    const checkTime = checkTimeInput ? checkTimeInput.value : '17:00';

    // Интервал проверки
    const checkIntervalSelect = document.getElementById('check-interval');
    const checkInterval = checkIntervalSelect ? checkIntervalSelect.value : 'daily';

    // Дни недели
    const selectedDays = [];
    document.querySelectorAll('.day-btn.selected').forEach(btn => {
        selectedDays.push(btn.dataset.day);
    });

    // Команды
    const teams = [];
    document.querySelectorAll('.team-editor-item').forEach(item => {
        const idInput = item.querySelector('.team-id-input');
        const nameInput = item.querySelector('.team-name-input');

        if (idInput && nameInput && idInput.value && nameInput.value) {
            teams.push({
                id: parseInt(idInput.value),
                name: nameInput.value.trim()
            });
        }
    });

    return {
        checkTime,
        checkInterval,
        checkDays: selectedDays.length > 0 ? selectedDays : ['mon', 'tue', 'wed', 'thu', 'fri'],
        teams: teams.length > 0 ? teams : DEFAULT_SETTINGS.teams
    };
}

// Инициализация менеджера настроек
function initSettingsManager() {
    // Кнопка сохранения настроек
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            saveSettingsBtn.innerHTML = '⏳ Сохраняем...';
            saveSettingsBtn.disabled = true;

            try {
                const result = await saveSettings();

                if (result.success) {
                    saveSettingsBtn.innerHTML = '✅ Сохранено!';

                    setTimeout(() => {
                        // Закрываем модальное окно
                        const settingsModal = document.getElementById('settings-modal');
                        if (settingsModal) {
                            settingsModal.style.display = 'none';
                        }

                        // Восстанавливаем кнопку
                        saveSettingsBtn.innerHTML = '💾 Сохранить';
                        saveSettingsBtn.disabled = false;

                        // Обновляем данные в основном интерфейсе
                        window.location.reload();
                    }, 1000);
                } else {
                    saveSettingsBtn.innerHTML = '❌ Ошибка';
                    saveSettingsBtn.disabled = false;

                    setTimeout(() => {
                        saveSettingsBtn.innerHTML = '💾 Сохранить';
                    }, 2000);
                }
            } catch (error) {
                console.error('Ошибка при сохранении:', error);
                saveSettingsBtn.innerHTML = '❌ Ошибка';
                saveSettingsBtn.disabled = false;

                setTimeout(() => {
                    saveSettingsBtn.innerHTML = '💾 Сохранить';
                }, 2000);
            }
        });
    }

    // Загружаем настройки при инициализации
    loadSettings().catch(console.error);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initSettingsManager();
});
