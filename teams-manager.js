// Модуль управления командами из JSON файла

import { tempoData } from './tempo-data.js';

// Путь к файлу команд
const TEAMS_FILE = 'teams.json';

// Кэш команд
let teamsCache = null;

// Загрузка команд из JSON файла
async function loadTeamsFromJson() {
    console.log('[TeamsManager] Загрузка команд из JSON файла...');

    try {
        // Если уже есть кэш, возвращаем его
        if (teamsCache) {
            console.log('[TeamsManager] Используем кэшированные команды');
            return teamsCache;
        }

        // Сначала проверяем пользовательские команды в хранилище
        const customTeamsResult = await chrome.storage.local.get('customTeams');
        if (customTeamsResult.customTeams && Array.isArray(customTeamsResult.customTeams)) {
            console.log('[TeamsManager] Используем пользовательские команды');
            teamsCache = customTeamsResult.customTeams;
            return teamsCache;
        }

        // Если нет пользовательских команд, загружаем из файла
        const response = await fetch(chrome.runtime.getURL(TEAMS_FILE));

        if (!response.ok) {
            throw new Error(`Ошибка загрузки файла: ${response.status}`);
        }

        const data = await response.json();

        if (!data.teams || !Array.isArray(data.teams)) {
            throw new Error('Неверный формат файла команд');
        }

        // Сохраняем в кэш
        teamsCache = data.teams;

        console.log(`[TeamsManager] Загружено команд: ${teamsCache.length}`);
        return teamsCache;

    } catch (error) {
        console.error('[TeamsManager] Ошибка загрузки команд:', error);

        // Возвращаем базовый список команд
        return getDefaultTeams();
    }
}

// Получение списка команд
async function getTeamsList() {
    const teams = await loadTeamsFromJson();
    return teams;
}

// Поиск команды по ID или имени
async function findTeam(searchTerm) {
    const teams = await getTeamsList();

    if (!searchTerm) return null;

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

// Фильтрация команд
async function filterTeams(searchTerm) {
    const teams = await getTeamsList();

    if (!searchTerm) return teams;

    const searchLower = searchTerm.toLowerCase().trim();

    return teams.filter(team =>
        team.name.toLowerCase().includes(searchLower) ||
        team.id.toString().includes(searchTerm)
    );
}

// Сортировка команд
async function sortTeams(sortBy = 'id') {
    const teams = await getTeamsList();
    const sorted = [...teams];

    if (sortBy === 'id') {
        sorted.sort((a, b) => a.id - b.id);
    } else if (sortBy === 'name') {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
}

// Получение команды по ID
async function getTeamById(id) {
    const teams = await getTeamsList();
    return teams.find(team => team.id === id) || null;
}

// Получение команды по имени
async function getTeamByName(name) {
    const teams = await getTeamsList();
    return teams.find(team => team.name === name) || null;
}

// Получение количества команд
async function getTeamsCount() {
    const teams = await getTeamsList();
    return teams.length;
}

// Обновление списка команд (добавление новой команды)
async function addTeam(team) {
    if (!team || !team.id || !team.name) {
        throw new Error('Команда должна иметь id и name');
    }

    const teams = await getTeamsList();

    // Проверяем, нет ли уже такой команды
    const existingTeam = teams.find(t => t.id === team.id);
    if (existingTeam) {
        throw new Error(`Команда с ID ${team.id} уже существует`);
    }

    // Добавляем команду
    teams.push(team);

    // Сортируем по ID
    teams.sort((a, b) => a.id - b.id);

    // Обновляем кэш
    teamsCache = teams;

    console.log(`[TeamsManager] Добавлена команда: ${team.id} - ${team.name}`);
    return team;
}

// Удаление команды по ID
async function removeTeam(id) {
    const teams = await getTeamsList();
    const index = teams.findIndex(team => team.id === id);

    if (index === -1) {
        throw new Error(`Команда с ID ${id} не найдена`);
    }

    const removedTeam = teams.splice(index, 1)[0];

    // Обновляем кэш
    teamsCache = teams;

    console.log(`[TeamsManager] Удалена команда: ${removedTeam.id} - ${removedTeam.name}`);
    return removedTeam;
}

// Получение дефолтных команд (резервный вариант)
function getDefaultTeams() {
    return [
        { id: 91, name: 'stream1-team' },
        { id: 92, name: 'stream2-team' },
        { id: 93, name: 'stream3-team' },
        { id: 94, name: 'stream4-team' }
    ];
}

// Очистка кэша
function clearTeamsCache() {
    teamsCache = null;
    console.log('[TeamsManager] Кэш команд очищен');
}

// Экспорт функций
export {
    getTeamsList,
    findTeam,
    filterTeams,
    sortTeams,
    getTeamById,
    getTeamByName,
    getTeamsCount,
    addTeam,
    removeTeam,
    clearTeamsCache
};
