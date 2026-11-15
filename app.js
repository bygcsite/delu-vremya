'use strict';

const STORAGE_KEY = 'quiet-todo.data.v2';
const LEGACY_STORAGE_KEY = 'quiet-todo.tasks.v1';
const form = document.querySelector('#task-form');
const input = document.querySelector('#task-input');
const list = document.querySelector('#task-list');
const status = document.querySelector('#status');
const filters = document.querySelectorAll('[data-filter]');
let { projects, tasks } = loadData() ?? { projects: [], tasks: [] };
let currentProject = 'all';
const projectSelect = document.querySelector('#task-project');
let currentFilter = 'all';
let showArchived = false;

// ID нужен только для связи записей. getRandomValues работает и без HTTPS.
function createId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Не доверяем localStorage: данные могут быть повреждены или изменены вручную.
function loadData(allowLegacy = true) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const data = stored === null
      ? { projects: [], tasks: allowLegacy ? JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]') : [] }
      : JSON.parse(stored);
    if (!data || !Array.isArray(data.projects) || !Array.isArray(data.tasks)) {
      throw new Error('Некорректный формат списка');
    }
    const projectIds = new Set();
    const savedProjects = [];
    for (const project of data.projects) {
      if (!project || typeof project.id !== 'string' || !project.id ||
          project.id === 'all' || projectIds.has(project.id) ||
          typeof project.name !== 'string' || !project.name.trim() || project.name.length > 60) continue;
      projectIds.add(project.id);
      savedProjects.push({ id: project.id, name: project.name.trim(), archived: project.archived === true });
    }
    const taskIds = new Set();
    const savedTasks = [];
    for (const task of data.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || taskIds.has(task.id) ||
          typeof task.text !== 'string' || !task.text.trim() || task.text.length > 300 ||
          typeof task.completed !== 'boolean') continue;
      taskIds.add(task.id);
      savedTasks.push({
        id: task.id,
        text: task.text.trim(),
        completed: task.completed,
        projectId: projectIds.has(task.projectId) ? task.projectId : '',
      });
    }
    status.textContent = '';
    return { projects: savedProjects, tasks: savedTasks };
  } catch {
    status.textContent = 'Не удалось прочитать сохранённые задачи. Текущий список оставлен без изменений.';
    return null;
  }
}

// Оба списка выбора проекта используют одинаковые подписи и значения.
function fillProjectSelect(select, selectedId, includeArchivedSelection = false) {
  const options = [{ id: '', name: 'Без проекта' }, ...projects.filter(project => !project.archived || (includeArchivedSelection && project.id === selectedId))].map(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    return option;
  });
  select.replaceChildren(...options);
  select.value = options.some(option => option.value === selectedId) ? selectedId : '';
}

function belongsToCurrentProject(task) {
  if (currentProject !== 'all') return task.projectId === currentProject;
  return !projects.some(project => project.id === task.projectId && project.archived);
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, projects }));
    status.textContent = '';
  } catch {
    status.textContent = 'Браузер не разрешил сохранение. Задачи доступны до обновления страницы.';
  }
}

// Текст задачи вставляем через textContent, чтобы введённый HTML оставался текстом.
function createTaskElement(task) {
  const item = document.createElement('li');
  item.className = 'task-item';
  const label = document.createElement('label');
  label.className = 'task-label';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', () => {
    task.completed = checkbox.checked;
    saveTasks();
    renderTasks();
  });
  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;
  const content = document.createElement('span');
  content.className = 'task-content';
  content.append(text);
  const project = projects.find(project => project.id === task.projectId);
  if (project && currentProject === 'all') {
    const projectName = document.createElement('span');
    projectName.className = 'task-project-name';
    projectName.textContent = project.name;
    content.append(projectName);
  }
  label.append(checkbox, content);
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'delete-button';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Удалить задачу: ${task.text}`);
  removeButton.addEventListener('click', () => {
    tasks = tasks.filter(existingTask => existingTask.id !== task.id);
    saveTasks();
    renderTasks();
    document.querySelector('#toggle-archived').focus();
  });
  const menu = document.createElement('details');
  menu.className = 'task-menu';
  const menuToggle = document.createElement('summary');
  menuToggle.textContent = '⋯';
  menuToggle.setAttribute('aria-label', `Действия с задачей: ${task.text}`);
  const menuPanel = document.createElement('div');
  menuPanel.className = 'task-menu-panel';
  const moveButton = document.createElement('button');
  moveButton.type = 'button';
  moveButton.textContent = 'Сменить проект';
  moveButton.addEventListener('click', () => {
    menu.open = false;
    taskPendingMove = task.id;
    document.querySelector('#move-task-description').textContent = task.text;
    fillProjectSelect(moveTaskSelect, task.projectId, true);
    moveTaskDialog.showModal();
  });
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    document.querySelectorAll('.task-menu').forEach(other => {
      if (other !== menu) other.open = false;
    });
  });
  menuPanel.append(moveButton);
  menu.append(menuToggle, menuPanel);
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.append(menu, removeButton);
  item.append(label, actions);
  return item;
}

function renderTasks() {
  renderProjects();
  const selectedProject = projects.find(project => project.id === currentProject);
  document.querySelector('.workspace').hidden = showArchived && !selectedProject;
  form.hidden = selectedProject?.archived === true;
  document.querySelector('.project-assignment').hidden = selectedProject?.archived === true;
  const projectTasks = tasks.filter(belongsToCurrentProject);
  const completedCount = projectTasks.filter(task => task.completed).length;
  const visibleTasks = projectTasks.filter(task => currentFilter === 'all' ||
    (currentFilter === 'completed' ? task.completed : !task.completed));
  list.replaceChildren(...visibleTasks.map(createTaskElement));
  document.querySelector('#total-count').textContent = projectTasks.length;
  document.querySelector('#remaining-count').textContent = `В работе: ${projectTasks.length - completedCount}`;
  document.querySelector('#clear-completed').hidden = completedCount === 0;
  document.querySelector('#progress-label').textContent = projectTasks.length
    ? `Выполнено ${completedCount} из ${projectTasks.length}` : 'Здесь начинается ваш прогресс';
  document.querySelector('#progress-bar').style.width = `${projectTasks.length ? completedCount / projectTasks.length * 100 : 0}%`;
  document.querySelector('#empty-state').hidden = visibleTasks.length > 0;
  const emptyMessages = {
    all: ['Всё начинается с одной задачи', 'Добавьте первое дело и двигайтесь в своём темпе.'],
    active: ['Можно выдохнуть', 'Задач в работе пока нет.'],
    completed: ['Всё ещё впереди', 'Выполненные задачи появятся здесь.'],
  };
  document.querySelector('#empty-title').textContent = emptyMessages[currentFilter][0];
  document.querySelector('#empty-description').textContent = emptyMessages[currentFilter][1];
  filters.forEach(button => button.setAttribute('aria-pressed', button.dataset.filter === currentFilter));
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim().slice(0, 300);
  if (!text) {
    input.value = '';
    input.focus();
    return;
  }
  const projectId = projects.some(project => project.id === projectSelect.value && !project.archived)
    ? projectSelect.value : '';
  tasks.push({ id: createId(), text, completed: false, projectId });
  if (currentProject !== 'all') currentProject = projectId;
  currentFilter = 'all';
  saveTasks();
  renderTasks();
  input.value = '';
  input.focus();
});

filters.forEach(button => button.addEventListener('click', () => {
  currentFilter = button.dataset.filter;
  renderTasks();
}));

document.querySelector('#clear-completed').addEventListener('click', () => {
  tasks = tasks.filter(task => !task.completed || !belongsToCurrentProject(task));
  saveTasks();
  renderTasks();
});

// Если список изменился в соседней вкладке, показываем актуальные задачи.
window.addEventListener('storage', event => {
  if (event.storageArea && event.storageArea !== localStorage) return;
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  // После очистки нового хранилища старый список не должен появляться снова.
  const data = loadData(false);
  if (!data) return;
  ({ tasks, projects } = data);
  if (currentProject !== 'all' && !projects.some(project => project.id === currentProject)) {
    currentProject = '';
  }
  const selectedProject = projects.find(project => project.id === currentProject);
  if (selectedProject) showArchived = selectedProject.archived;
  renderTasks();
});

// Переключение проекта влияет на список, счётчики и очистку выполненных.
function renderProjects() {
  fillProjectSelect(projectSelect, projectSelect.value);
  const visibleProjects = projects.filter(project => project.archived === showArchived);
  const projectOptions = showArchived ? visibleProjects
    : [{ id: 'all', name: 'Все задачи' }, { id: '', name: 'Без проекта' }, ...visibleProjects];
  const buttons = projectOptions.map(project => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(currentProject === project.id));
    button.append(document.createTextNode(project.name));
    const count = document.createElement('span');
    count.textContent = tasks.filter(task => project.id === 'all' ? !projects.some(item => item.id === task.projectId && item.archived) : task.projectId === project.id).length;
    button.append(count);
    button.addEventListener('click', () => {
      currentProject = project.id;
      projectSelect.value = project.id === 'all' ? '' : project.id;
      renderTasks();
    });
    return button;
  });
  document.querySelector('#project-list').replaceChildren(...buttons);
  const selectedProject = projects.find(project => project.id === currentProject);
  document.querySelector('#project-actions').hidden = !selectedProject;
  document.querySelector('#selected-project-name').textContent = selectedProject?.name ?? '';
  document.querySelector('#archive-project').textContent = selectedProject?.archived ? 'Вернуть в работу' : 'Завершить проект';
  document.querySelector('#archive-empty').hidden = !showArchived || visibleProjects.length > 0;
  const archiveButton = document.querySelector('#toggle-archived');
  archiveButton.textContent = showArchived ? 'Назад' : 'Архив проектов';
  archiveButton.setAttribute('aria-pressed', String(showArchived));
}

const projectForm = document.querySelector('#project-form');
const projectNameInput = document.querySelector('#project-name');
document.querySelector('#show-project-form').addEventListener('click', () => {
  projectForm.hidden = false;
  projectNameInput.focus();
});
document.querySelector('#cancel-project').addEventListener('click', () => {
  projectForm.hidden = true;
  projectForm.reset();
  document.querySelector('#show-project-form').focus();
});
projectForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = projectNameInput.value.trim().slice(0, 60);
  if (!name) return;
  const existingProject = projects.find(project => project.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
  const project = existingProject ?? { id: createId(), name, archived: false };
  // Повторное создание завершённого проекта возвращает его в работу.
  project.archived = false;
  showArchived = false;
  if (!existingProject) projects.push(project);
  currentProject = project.id;
  currentFilter = 'all';
  saveTasks();
  renderTasks();
  projectSelect.value = project.id;
  projectForm.reset();
  projectForm.hidden = true;
  input.focus();
});

// Завершённый проект хранится целиком: архивирование не меняет статусы задач.
document.querySelector('#archive-project').addEventListener('click', () => {
  const project = projects.find(project => project.id === currentProject);
  if (!project) return;
  project.archived = !project.archived;
  showArchived = project.archived;
  saveTasks();
  renderTasks();
});

document.querySelector('#toggle-archived').addEventListener('click', () => {
  showArchived = !showArchived;
  currentProject = showArchived ? (projects.find(project => project.archived)?.id ?? 'all') : 'all';
  currentFilter = 'all';
  renderTasks();
});

const deleteDialog = document.querySelector('#delete-project-dialog');
const deleteTasksCheckbox = document.querySelector('#delete-project-tasks');
let projectPendingDeletion = null;

// По умолчанию удаляется только проект: удаление его задач выбирается отдельно.
document.querySelector('#delete-project').addEventListener('click', () => {
  const project = projects.find(project => project.id === currentProject);
  if (!project) return;
  projectPendingDeletion = project.id;
  deleteTasksCheckbox.checked = false;
  document.querySelector('#delete-dialog-description').textContent = `Проект «${project.name}» будет удалён.`;
  deleteDialog.showModal();
});

document.querySelector('#cancel-delete-project').addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('close', () => {
  projectPendingDeletion = null;
});

document.querySelector('#delete-project-form').addEventListener('submit', event => {
  event.preventDefault();
  const projectId = projectPendingDeletion;
  // За время открытого окна проект могли удалить в соседней вкладке.
  if (!projects.some(project => project.id === projectId)) {
    deleteDialog.close();
    return;
  }
  if (deleteTasksCheckbox.checked) {
    tasks = tasks.filter(task => task.projectId !== projectId);
  } else {
    tasks.forEach(task => {
      if (task.projectId === projectId) task.projectId = '';
    });
  }
  projects = projects.filter(project => project.id !== projectId);
  currentProject = '';
  showArchived = false;
  saveTasks();
  renderTasks();
  deleteDialog.close();
  input.focus();
});

const moveTaskDialog = document.querySelector('#move-task-dialog');
const moveTaskSelect = document.querySelector('#move-task-project');
let taskPendingMove = null;

document.querySelector('#cancel-move-task').addEventListener('click', () => moveTaskDialog.close());
moveTaskDialog.addEventListener('close', () => { taskPendingMove = null; });
document.querySelector('#move-task-form').addEventListener('submit', event => {
  event.preventDefault();
  const task = tasks.find(task => task.id === taskPendingMove);
  const projectId = moveTaskSelect.value;
  const targetProject = projects.find(project => project.id === projectId);
  // Проверяем актуальность выбора: другую вкладку могли изменить во время диалога.
  if (task && (projectId === '' || (targetProject && (!targetProject.archived || task.projectId === projectId)))) {
    task.projectId = projectId;
    saveTasks();
    renderTasks();
  }
  moveTaskDialog.close();
  document.querySelector('#toggle-archived').focus();
});

// Закрываем выпадающие действия по Escape и нажатию вне меню.
document.addEventListener('click', event => {
  document.querySelectorAll('.task-menu[open]').forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.task-menu[open]').forEach(menu => {
    menu.open = false;
    menu.querySelector('summary').focus();
  });
});

renderTasks();
